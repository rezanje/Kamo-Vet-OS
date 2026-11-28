import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { bacaSaringan, muatAkses, muatCabang, muatDaftar, muatRekap, STATUS_FILTER } from "@/lib/setoran-server";
import { buatSetoran } from "@/lib/setoran-actions";
import { SubmitButton } from "@/components/SubmitButton";
import { hariIniWIB } from "@/lib/tanggal";
import { periodeBawaan, pesanSetoran, rp, tanggalPendek, warnaBadge, type BarisDaftar, type BasisSetoran, type RekapSetoran } from "@/lib/setoran";

type SP = Record<string, string | undefined>;
const lbl: React.CSSProperties = { display: "grid", gap: 3, fontSize: 12, color: "var(--tm)" };

function Lencana({ teks }: { teks: string }) {
  const w = warnaBadge(teks);
  return <span style={{ background: w.bg, color: w.fg, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>{teks}</span>;
}

function RekapPanel({ r }: { r: RekapSetoran }) {
  return (
    <section className="card" aria-label="Rekap per cabang">
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>Rekap per cabang</h3>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, marginBottom: 8 }}>
        <span>Menunggu persetujuan: <strong data-testid="menunggu">{r.menunggu_persetujuan}</strong></span>
        <span>Terlambat: <strong>{r.terlambat}</strong></span>
        <span>Umur menunggu — 0–1 hari: <strong>{r.umur_menunggu.hari_0_1}</strong> · 2–3: <strong>{r.umur_menunggu.hari_2_3}</strong> · 4–7: <strong>{r.umur_menunggu.hari_4_7}</strong> · 8+: <strong>{r.umur_menunggu.hari_8_plus}</strong></span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl"><thead><tr><th>Cabang</th><th>Setoran</th><th>Kewajiban</th><th>Pengeluaran</th><th>Diharapkan</th><th>Disetor</th><th>Kurang</th><th>Lebih</th></tr></thead>
          <tbody>
            {r.cabang.map((c) => <tr key={c.branch_id}><td>{c.cabang}</td><td>{c.jumlah}</td><td>{rp(c.kewajiban)}</td><td>{rp(c.pengeluaran)}</td><td>{rp(c.diharapkan)}</td><td>{rp(c.disetor)}</td><td>{rp(c.kurang)}</td><td>{rp(c.lebih)}</td></tr>)}
            <tr style={{ fontWeight: 700 }}><td>Total</td><td>{r.total.jumlah}</td><td>{rp(r.total.kewajiban)}</td><td>{rp(r.total.pengeluaran)}</td><td>{rp(r.total.diharapkan)}</td><td>{rp(r.total.disetor)}</td><td data-testid="total-kurang">{rp(r.total.kurang)}</td><td data-testid="total-lebih">{rp(r.total.lebih)}</td></tr>
          </tbody></table>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--tm)", marginTop: 6 }}>Kurang/Lebih dihitung dari setoran yang sudah diajukan atau disetujui. Halaman ini hanya untuk Owner, Finance, Admin.</p>
    </section>
  );
}

function Baris({ b, basis, penyetuju }: { b: BarisDaftar; basis: BasisSetoran; penyetuju: boolean }) {
  return (
    <tr>
      <td><Link href={`${basis}/${b.id}`}>{b.no_setoran}</Link></td>
      <td>{b.cabang}</td>
      <td>{tanggalPendek(b.periode_mulai)}{b.periode_mulai !== b.periode_selesai ? ` – ${tanggalPendek(b.periode_selesai)}` : ""}</td>
      <td>{tanggalPendek(b.jadwal)} {b.batas_jam}</td>
      <td style={{ textAlign: "right" }}>{rp(b.kewajiban)}</td>
      <td style={{ textAlign: "right" }}>{rp(b.sisa)}</td>
      <td><Lencana teks={b.badge} /> <span style={{ fontSize: 11.5, color: "var(--tm)" }}>{b.status}</span></td>
      {penyetuju && <td style={{ textAlign: "right" }}>{b.selisih !== undefined ? (b.selisih === null ? rp(b.selisih_sementara ?? 0) : rp(b.selisih)) : "-"}</td>}
      {penyetuju && <td>{b.umur_hari !== null ? `${b.umur_hari} hari` : "-"}</td>}
    </tr>
  );
}

// Daftar + rekap. Penyetuju (Owner/Finance/Admin/Admin Umum) melihat kotak masuk, rekap, selisih, dan unduh Excel; staf hanya setoran cabangnya (kewajiban & sisa, tanpa selisih).
export async function SetoranDaftarView({ basis, sp }: { basis: BasisSetoran; sp: SP }) {
  const supabase = await createClient();
  const akses = await muatAkses(supabase);
  if (!akses.masuk) return <div className="card"><p>Anda tidak punya akses ke Rekap Setoran.</p></div>;
  const hari = hariIniWIB();
  const f = bacaSaringan(sp, hari);
  const bawaan = periodeBawaan(hari);
  let daftar: Awaited<ReturnType<typeof muatDaftar>> | null = null, rekap: RekapSetoran | null = null, galat = sp.error ?? "";
  try {
    [daftar, rekap] = await Promise.all([muatDaftar(supabase, f), akses.penyetuju ? muatRekap(supabase, f) : Promise.resolve(null)]);
  } catch (e) { galat = pesanSetoran(e instanceof Error ? e.message : "Daftar belum dapat dimuat."); }
  const cabang = await muatCabang(supabase);
  const inbox = (daftar?.baris ?? []).filter((b) => b.status === "Diajukan");
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div><div className="pg-hd">Rekap Setoran</div><div className="pg-sub">Kewajiban setoran per periode, pengeluaran dari dana setoran, dan penutupan oleh Finance</div>
        {akses.penyetuju && <div style={{ marginTop: 6, fontSize: 13 }}><Link href="/kas-bank/setoran/riwayat" data-testid="tautan-riwayat">Riwayat Setoran (per hari, kas toko) →</Link> <span style={{ fontSize: 11.5, color: "var(--tm)" }}>tampilan awal, hanya lihat</span></div>}</div>
      {galat && <div className="p2ban" role="alert" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>{galat}</div>}
      {sp.success && <div className="p2ban" role="status">{sp.success}</div>}

      {akses.penyetuju && inbox.length > 0 && (
        <section className="card" aria-label="Menunggu persetujuan" style={{ borderColor: "#93c5fd" }}>
          <h3 style={{ fontSize: 14, marginBottom: 6 }}>Menunggu persetujuan ({inbox.length})</h3>
          {inbox.map((b) => <div key={b.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "5px 0", borderBottom: ".5px solid var(--bd)", fontSize: 13, flexWrap: "wrap" }}>
            <span><Link href={`${basis}/${b.id}`}>{b.no_setoran}</Link> · {b.cabang} · diajukan {b.umur_hari ?? 0} hari lalu · dibuat {b.dibuat_oleh}</span><strong>{rp(b.kewajiban)}</strong></div>)}
        </section>
      )}

      <section className="card" aria-label="Buat periode setoran">
        <h3 style={{ fontSize: 14, marginBottom: 6 }}>Buat periode setoran</h3>
        <form action={buatSetoran} style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="basis" value={basis} /><input type="hidden" name="request_key" value={crypto.randomUUID()} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <label style={lbl}>Cabang<select className="fi" name="branchId" required defaultValue={cabang.length === 1 ? cabang[0].id : ""}>{cabang.length !== 1 && <option value="" disabled>Pilih cabang</option>}{cabang.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
            <label style={lbl}>Periode mulai<input className="fi" type="date" name="mulai" required defaultValue={bawaan.mulai} max={hari} /></label>
            <label style={lbl}>Periode selesai<input className="fi" type="date" name="selesai" required defaultValue={bawaan.selesai} max={hari} /></label>
            <label style={lbl}>Jadwal setoran<input className="fi" type="date" name="jadwal" required defaultValue={bawaan.jadwal} /></label>
            <label style={lbl}>Batas jam<input className="fi" type="time" name="jam" defaultValue="12:00" required /></label>
          </div>
          <div><SubmitButton className="btn-acc" pendingText="Membuat…">Buat periode</SubmitButton> <span style={{ fontSize: 12, color: "var(--tm)" }}>Shift yang sudah ditutup di periode itu otomatis dihitung.</span></div>
        </form>
      </section>

      <form method="get" className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }} aria-label="Saringan">
        <label style={lbl}>Dari<input className="fi" type="date" name="dari" defaultValue={f.dari} /></label>
        <label style={lbl}>Sampai<input className="fi" type="date" name="sampai" defaultValue={f.sampai} /></label>
        <label style={lbl}>Cabang<select className="fi" name="branch" defaultValue={f.branch ?? ""}><option value="">Semua</option>{cabang.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
        <label style={lbl}>Status<select className="fi" name="status" defaultValue={f.status ?? ""}><option value="">Semua</option>{STATUS_FILTER.map((s) => <option key={s}>{s}</option>)}</select></label>
        <button className="btn-acc" type="submit">Terapkan</button>
        {akses.penyetuju && <a className="btn-def" href={`${basis}/unduh?${q}`}>Unduh Excel</a>}
      </form>

      {rekap && <RekapPanel r={rekap} />}

      <section className="card" aria-label="Daftar setoran">
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th>No</th><th>Cabang</th><th>Periode</th><th>Jadwal</th><th>Kewajiban</th><th>Sisa</th><th>Status</th>{akses.penyetuju && <th>Selisih</th>}{akses.penyetuju && <th>Menunggu</th>}</tr></thead>
            <tbody>
              {(daftar?.baris ?? []).map((b) => <Baris key={b.id} b={b} basis={basis} penyetuju={akses.penyetuju} />)}
              {(daftar?.baris ?? []).length === 0 && <tr><td colSpan={akses.penyetuju ? 9 : 7} style={{ textAlign: "center", color: "var(--tm)" }}>Belum ada setoran pada saringan ini.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
