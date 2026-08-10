import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { hariIniWIB } from "@/lib/tanggal";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Row = {
  id: string; metrik: string; target: number | null; realisasi: number | null; skor: number; catatan: string | null;
  employee_id: string;
  employees: Rel<{ nama: string; jabatan: string | null; branches: Rel<{ name: string }> }>;
};

// Warna & label skor — supaya yang butuh perhatian langsung kelihatan.
function nilaiSkor(skor: number): { label: string; badge: string } {
  if (skor >= 90) return { label: "Sangat baik", badge: "g" };
  if (skor >= 75) return { label: "Baik", badge: "b" };
  if (skor >= 60) return { label: "Cukup", badge: "x" };
  return { label: "Perlu perhatian", badge: "r" };
}

export default async function LaporanKpiPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string; cabang?: string }>;
}) {
  const sp = await searchParams;
  const periode = sp.periode || hariIniWIB().slice(0, 7);
  const cabang = sp.cabang || "";

  const supabase = await createClient();
  const [{ data }, { data: cabangList }] = await Promise.all([
    supabase.from("kpi_records")
      .select("id, employee_id, metrik, target, realisasi, skor, catatan, employees(nama, jabatan, branches(name))")
      .eq("periode", periode)
      .order("skor", { ascending: false }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);

  const rows = ((data ?? []) as unknown as Row[])
    .map((r) => {
      const emp = one(r.employees);
      return {
        ...r,
        skor: Number(r.skor),
        nama: emp?.nama ?? "—",
        jabatan: emp?.jabatan ?? "—",
        cabangNama: one(emp?.branches ?? null)?.name ?? "—",
      };
    })
    .filter((r) => !cabang || r.cabangNama === cabang);

  // Satu karyawan bisa punya beberapa metrik — rata-ratanya yang dipakai untuk
  // menilai orangnya, bukan skor satu metrik yang kebetulan paling tinggi.
  const perOrang = new Map<string, { nama: string; jabatan: string; cabang: string; skor: number[] }>();
  for (const r of rows) {
    const o = perOrang.get(r.employee_id) ?? { nama: r.nama, jabatan: r.jabatan, cabang: r.cabangNama, skor: [] };
    o.skor.push(r.skor);
    perOrang.set(r.employee_id, o);
  }
  const ranking = [...perOrang.entries()]
    .map(([id, o]) => ({ id, ...o, rata: o.skor.reduce((a, s) => a + s, 0) / o.skor.length }))
    .sort((a, b) => b.rata - a.rata);

  const rataSemua = ranking.length ? ranking.reduce((a, r) => a + r.rata, 0) / ranking.length : 0;
  const perluPerhatian = ranking.filter((r) => r.rata < 60).length;

  return (
    <LaporanPage
      icon="ti-chart-dots" title="NILAI KPI KARYAWAN"
      desc="Skor per karyawan dan per metrik. Skor di bawah 60 ditandai perlu perhatian."
      filter={
        <>
          <div>
            <label className="flab">Periode</label>
            <input className="fi" type="month" name="periode" defaultValue={periode} />
          </div>
          <div style={{ minWidth: 200 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang" defaultValue={cabang}>
              <option value="">Semua cabang</option>
              {(cabangList ?? []).map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Karyawan dinilai", nilai: `${ranking.length} orang` },
          { label: "Rata-rata skor", nilai: rataSemua ? rataSemua.toFixed(1) : "—" },
          { label: "Perlu perhatian", nilai: `${perluPerhatian} orang`, warna: perluPerhatian ? "#b91c1c" : undefined },
        ]} />
      }
    >
      {ranking.length > 0 && (
        <div className="crm-sec">
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 7 }}>
            <i className="ti ti-medal" /> Peringkat karyawan (rata-rata semua metrik)
          </div>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th><th>Karyawan</th><th style={{ width: 160 }}>Cabang</th>
                <th style={{ width: 80, textAlign: "right" }}>Skor</th><th style={{ width: 130 }}>Penilaian</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r, i) => {
                const n = nilaiSkor(r.rata);
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11, fontWeight: i < 3 ? 800 : 400, color: i < 3 ? "#b45309" : "var(--tm)" }}>{i + 1}</td>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                      {r.nama}
                      <div style={{ fontSize: 9.5, color: "var(--td)" }}>{r.jabatan}</div>
                    </td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.cabang}</td>
                    <td style={{ textAlign: "right", fontSize: 12, fontWeight: 800 }}>{r.rata.toFixed(1)}</td>
                    <td><span className={`bge ${n.badge}`}>{n.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 7 }}>
          <i className="ti ti-list-details" /> Rincian per metrik
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Karyawan</th><th style={{ width: 180 }}>Metrik</th>
                <th style={{ width: 100, textAlign: "right" }}>Target</th>
                <th style={{ width: 100, textAlign: "right" }}>Realisasi</th>
                <th style={{ width: 70, textAlign: "right" }}>Skor</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11 }}>{r.nama}</td>
                  <td style={{ fontSize: 11 }}>{r.metrik}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>
                    {r.target == null ? "—" : Number(r.target).toLocaleString("id-ID")}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>
                    {r.realisasi == null ? "—" : Number(r.realisasi).toLocaleString("id-ID")}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: r.skor < 60 ? "#b91c1c" : undefined }}>
                    {r.skor}
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.catatan ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <TabelKosong kolom={6} pesan="Belum ada penilaian KPI untuk periode ini. Isi dulu di HRIS → KPI karyawan." />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </LaporanPage>
  );
}
