import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { tanggalIndo, FOLLOWUP_JENIS } from "@/lib/followup";
import { hariIniWIB } from "@/lib/tanggal";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Row = {
  id: string; jenis: string; tanggal: string; catatan: string | null;
  pets: Rel<{ name: string; species: string | null }>;
  customers: Rel<{ name: string; phone: string | null }>;
  branches: Rel<{ name: string }>;
};

// Selisih hari terhadap hari ini. Negatif = sudah lewat.
function selisihHari(tanggal: string, hariIni: string): number {
  const a = Date.parse(`${tanggal}T00:00:00Z`);
  const b = Date.parse(`${hariIni}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

export default async function JadwalAnabulPage({
  searchParams,
}: {
  searchParams: Promise<{ jenis?: string; horizon?: string }>;
}) {
  const sp = await searchParams;
  const jenis = sp.jenis || "";
  const horizon = Number(sp.horizon) || 30;   // lihat berapa hari ke depan

  const supabase = await createClient();
  const hariIni = hariIniWIB();
  const batas = new Date(Date.parse(`${hariIni}T00:00:00Z`) + horizon * 86_400_000)
    .toISOString().slice(0, 10);

  // Sumbernya follow_ups yang diisi dokter di rekam medis. Yang sudah 'Selesai'
  // atau 'Batal' tidak ikut — laporan ini soal siapa yang MASIH perlu dihubungi.
  let q = supabase
    .from("follow_ups")
    .select("id, jenis, tanggal, catatan, pets(name, species), customers(name, phone), branches(name)")
    .in("status", ["Menunggu", "Terkirim"])
    .lte("tanggal", batas)
    .order("tanggal");
  if (jenis) q = q.eq("jenis", jenis);

  const { data } = await q.limit(500);
  const rows = (data ?? []) as unknown as Row[];

  const lewat = rows.filter((r) => selisihHari(r.tanggal, hariIni) < 0);
  const hariIniCount = rows.filter((r) => selisihHari(r.tanggal, hariIni) === 0);
  const mendatang = rows.filter((r) => selisihHari(r.tanggal, hariIni) > 0);

  return (
    <LaporanPage
      icon="ti-calendar-heart" title="JADWAL ANABUL"
      desc="Anabul yang sudah waktunya vaksin, kontrol, atau grooming — termasuk yang sudah lewat."
      filter={
        <>
          <div style={{ minWidth: 180 }}>
            <label className="flab">Jenis</label>
            <select className="fi" name="jenis" defaultValue={jenis}>
              <option value="">Semua jenis</option>
              {FOLLOWUP_JENIS.map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 160 }}>
            <label className="flab">Lihat sampai</label>
            <select className="fi" name="horizon" defaultValue={String(horizon)}>
              <option value="7">7 hari ke depan</option>
              <option value="30">30 hari ke depan</option>
              <option value="90">90 hari ke depan</option>
            </select>
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Sudah lewat", nilai: `${lewat.length} ekor`, warna: lewat.length ? "#b91c1c" : undefined },
          { label: "Hari ini", nilai: `${hariIniCount.length} ekor`, warna: "#b45309" },
          { label: "Mendatang", nilai: `${mendatang.length} ekor` },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Tanggal</th><th style={{ width: 90 }}>Status</th>
                <th>Anabul</th><th>Pemilik</th><th style={{ width: 130 }}>No. HP</th>
                <th style={{ width: 100 }}>Jenis</th><th style={{ width: 150 }}>Cabang</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = selisihHari(r.tanggal, hariIni);
                const hewan = one(r.pets);
                const pemilik = one(r.customers);
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 10.5 }}>{tanggalIndo(r.tanggal)}</td>
                    <td>
                      {d < 0
                        ? <span className="bge r">Telat {Math.abs(d)} hari</span>
                        : d === 0
                          ? <span className="bge b">Hari ini</span>
                          : <span className="bge g">{d} hari lagi</span>}
                    </td>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                      {hewan?.name ?? "—"}
                      <span style={{ fontSize: 9.5, color: "var(--td)" }}> · {hewan?.species ?? "—"}</span>
                    </td>
                    <td style={{ fontSize: 11 }}>{pemilik?.name ?? "—"}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{pemilik?.phone ?? "—"}</td>
                    <td style={{ fontSize: 10.5 }}>{r.jenis}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{one(r.branches)?.name ?? "—"}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <TabelKosong kolom={7} pesan="Tidak ada jadwal anabul di rentang ini." />}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
          Untuk mengirim pengingat WhatsApp-nya, buka Klinik → Follow Up.
        </div>
      </div>
    </LaporanPage>
  );
}
