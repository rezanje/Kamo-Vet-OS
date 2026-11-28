import Link from "next/link";
import { JUDUL_HALAMAN, SubJudul } from "./gaya";
import { RingkasanKartu, TabelHarian, TabelPeriode } from "./SetoranRiwayatTabel";
import { createClient, createClientLintasCabang } from "@/lib/supabase/server";
import { muatAkses, muatDaftar } from "@/lib/setoran-server";
import { muatCabangRiwayat, muatRiwayat, type HasilRiwayat } from "@/lib/setoran-riwayat-server";
import { bacaSaringanRiwayat, pilihCabangRiwayat } from "@/lib/setoran-riwayat";
import { pesanSetoran, tanggalPendek, type BarisDaftar } from "@/lib/setoran";
import { hariIniWIB } from "@/lib/tanggal";

type SP = Record<string, string | undefined>;
const lbl: React.CSSProperties = { display: "grid", gap: 3, fontSize: 12, color: "var(--tm)" };
// Riwayat Setoran — tampilan awal HANYA LIHAT. Memuat kas toko satu cabang per hari. Hanya penyetuju (Owner/Finance/Admin/Admin Umum): berisi lebih/kurang setor.
export async function SetoranRiwayatView({ sp }: { sp: SP }) {
  const supabase = await createClient();
  const akses = await muatAkses(supabase);
  const basis = "/kas-bank/setoran";
  const kepala = (
    <div>
      <div className="pg-hd" data-judul-halaman style={JUDUL_HALAMAN}>Riwayat Setoran</div>
    </div>
  );
  if (!akses.masuk || !akses.penyetuju) return <div style={{ display: "grid", gap: 12 }}>{kepala}<div className="card"><p>Halaman ini hanya untuk Owner, Finance, dan Admin.</p></div></div>;

  const hari = hariIniWIB();
  const f = bacaSaringanRiwayat(sp, hari);
  let galat = "";
  let cabangPilih: ReturnType<typeof pilihCabangRiwayat> = { daftar: [], terpilih: null };
  let hasil: HasilRiwayat | null = null;
  let periode: BarisDaftar[] = [];
  try {
    const { cabangAktif } = await createClientLintasCabang();
    cabangPilih = pilihCabangRiwayat(await muatCabangRiwayat(supabase), f.cabang, cabangAktif);
    if (cabangPilih.terpilih) {
      const b = cabangPilih.terpilih.id;
      const [h, d] = await Promise.all([
        muatRiwayat(supabase, { branchId: b, dari: f.dari, sampai: f.sampai }),
        muatDaftar(supabase, { dari: f.dari, sampai: f.sampai, branch: b, status: null, kasir: null }).catch(() => null),
      ]);
      hasil = h;
      periode = d?.baris ?? [];
      if (!d) galat = "Daftar periode setoran belum dapat dimuat; angka per hari tetap ditampilkan.";
    }
  } catch (e) { galat = pesanSetoran(e instanceof Error ? e.message : "Riwayat belum dapat dimuat."); }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {kepala}
      <div className="p2ban" role="note" data-testid="label-awal">Tampilan awal (hanya lihat) - belum mengubah angka Harus disetor di Rekap Setoran.</div>
      <div style={{ fontSize: 12.5 }}><Link href={basis}>← Kembali ke Rekap Setoran</Link></div>
      {galat && <div className="p2ban" role="alert" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>{galat}</div>}

      <form method="get" className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }} aria-label="Saringan">
        <label style={lbl}>Cabang<select className="fi" name="cabang" defaultValue={cabangPilih.terpilih?.id ?? ""}>{cabangPilih.daftar.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label style={lbl}>Dari tanggal<input className="fi" type="date" name="dari" defaultValue={f.dari} max={hari} /></label>
        <label style={lbl}>Sampai tanggal<input className="fi" type="date" name="sampai" defaultValue={f.sampai} max={hari} /></label>
        <button className="btn-acc" type="submit">Terapkan</button>
      </form>
      {f.dipotong && <div className="p2ban" role="status">Rentang dibatasi 366 hari terakhir; tanggal Dari disesuaikan.</div>}

      {cabangPilih.daftar.length === 0 && <div className="card"><p>Tidak ada cabang toko yang bisa Anda buka.</p></div>}
      {cabangPilih.terpilih && hasil && !hasil.akun && <div className="card"><p>{cabangPilih.terpilih.name} belum punya rekening kas toko yang aktif.</p></div>}
      {cabangPilih.terpilih && hasil?.akun && hasil.hitung && (
        <>
          <div style={{ fontSize: 12.5, color: "var(--tm)" }} data-testid="info-akun">{cabangPilih.terpilih.name} · kas toko: {hasil.akun.nama} (akun {hasil.akun.coa_code}) · {tanggalPendek(f.dari)} s/d {tanggalPendek(f.sampai)}</div>
          <RingkasanKartu r={hasil.hitung.ringkasan} namaAkun={hasil.akun.nama} />
          <section className="card" aria-label="Riwayat per hari">
            <SubJudul>Per hari</SubJudul>
            <TabelHarian hari={hasil.hitung.hari} />
            <p style={{ fontSize: 11.5, color: "var(--tm)", marginTop: 6 }}>
              Tanggal menurut WIB. Hanya hari yang ada shift ditutup atau mutasi kas yang tampil. Selisih setor harian positif = kelebihan setor (ditransfer lebih besar dari yang harus disetor), negatif = kekurangan setor. Kumulatif dihitung sejak tanggal Dari. Pengeluaran diambil dari jurnal pengeluaran di akun kas toko; bila pengeluaran itu sudah terpotong di kas tutup shift, Harus disetor bisa terlalu kecil, mohon dicek.
            </p>
          </section>
        </>
      )}
      {cabangPilih.terpilih && (
        <section className="card" aria-label="Periode setoran tercatat">
          <SubJudul>Periode setoran tercatat</SubJudul>
          <TabelPeriode baris={periode} basis={basis} />
        </section>
      )}
    </div>
  );
}
