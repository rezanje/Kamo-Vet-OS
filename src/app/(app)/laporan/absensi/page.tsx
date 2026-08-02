import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { hariIniWIB } from "@/lib/followup";
import { rekapAbsensi, jamMenit, JAM_KERJA_DEFAULT, type BarisAbsensi, type JamKerja } from "@/lib/laporan-hris";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

export default async function LaporanAbsensiPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string; cabang?: string }>;
}) {
  const sp = await searchParams;
  const periode = sp.periode || hariIniWIB().slice(0, 7);   // YYYY-MM
  const cabang = sp.cabang || "";

  const supabase = await createClient();

  // Rentang satu bulan penuh. Bulan 12 harus naik ke Januari tahun berikutnya —
  // ditulis eksplisit supaya tidak jadi "bulan 13" yang tidak pernah cocok.
  const [th, bl] = periode.split("-").map(Number);
  const awal = `${periode}-01`;
  const akhir = bl === 12 ? `${th + 1}-01-01` : `${th}-${String(bl + 1).padStart(2, "0")}-01`;

  const [{ data: absen }, { data: karyawan }, { data: setting }, { data: cabangList }] = await Promise.all([
    supabase.from("attendance").select("employee_id, status, jam_masuk, jam_pulang")
      .gte("tanggal", awal).lt("tanggal", akhir),
    supabase.from("employees").select("id, nama, jabatan, status, branches(name)").order("nama"),
    supabase.from("company_settings")
      .select("jam_masuk_standar, jam_pulang_standar, toleransi_telat_menit").maybeSingle(),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);

  const jamKerja: JamKerja = setting
    ? {
        jamMasukStandar: String(setting.jam_masuk_standar),
        jamPulangStandar: String(setting.jam_pulang_standar),
        toleransiMenit: Number(setting.toleransi_telat_menit),
      }
    : JAM_KERJA_DEFAULT;

  const rekap = rekapAbsensi((absen ?? []) as BarisAbsensi[], jamKerja);

  type Emp = { id: string; nama: string; jabatan: string | null; status: string; branches: Rel<{ name: string }> };
  const rows = ((karyawan ?? []) as unknown as Emp[])
    .filter((e) => !cabang || one(e.branches)?.name === cabang)
    .map((e) => ({
      ...e,
      cabangNama: one(e.branches)?.name ?? "—",
      r: rekap.get(e.id) ?? {
        employee_id: e.id, hadir: 0, izin: 0, sakit: 0, alpha: 0, cuti: 0,
        telat: 0, menitTelat: 0, menitLembur: 0,
      },
    }));

  const totalTelat = rows.reduce((a, r) => a + r.r.telat, 0);
  const totalAlpha = rows.reduce((a, r) => a + r.r.alpha, 0);
  const totalLembur = rows.reduce((a, r) => a + r.r.menitLembur, 0);

  return (
    <LaporanPage
      icon="ti-clock-check" title="REKAP ABSENSI"
      desc={`Telat, bolos, dan lembur per karyawan. Jam kerja standar ${String(jamKerja.jamMasukStandar).slice(0, 5)}–${String(jamKerja.jamPulangStandar).slice(0, 5)}, toleransi ${jamKerja.toleransiMenit} menit.`}
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
          { label: "Karyawan", nilai: `${rows.length} orang` },
          { label: "Total hari telat", nilai: `${totalTelat} hari`, warna: totalTelat ? "#b45309" : undefined },
          { label: "Total bolos (alpha)", nilai: `${totalAlpha} hari`, warna: totalAlpha ? "#b91c1c" : undefined },
          { label: "Total lembur", nilai: jamMenit(totalLembur), warna: "#15803d" },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Karyawan</th><th style={{ width: 150 }}>Cabang</th>
                <th style={{ width: 60, textAlign: "center" }}>Hadir</th>
                <th style={{ width: 90, textAlign: "center" }}>Telat</th>
                <th style={{ width: 60, textAlign: "center" }}>Izin</th>
                <th style={{ width: 60, textAlign: "center" }}>Sakit</th>
                <th style={{ width: 60, textAlign: "center" }}>Cuti</th>
                <th style={{ width: 60, textAlign: "center" }}>Alpha</th>
                <th style={{ width: 90, textAlign: "right" }}>Lembur</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.id} style={{ opacity: e.status === "Aktif" ? 1 : 0.55 }}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                    {e.nama}
                    <div style={{ fontSize: 9.5, color: "var(--td)" }}>{e.jabatan ?? "—"}</div>
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{e.cabangNama}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{e.r.hadir}</td>
                  <td style={{ textAlign: "center", fontSize: 11, color: e.r.telat ? "#b45309" : "var(--td)" }}>
                    {e.r.telat ? `${e.r.telat}x · ${jamMenit(e.r.menitTelat)}` : "—"}
                  </td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{e.r.izin || "—"}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{e.r.sakit || "—"}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{e.r.cuti || "—"}</td>
                  <td style={{ textAlign: "center", fontSize: 11, color: e.r.alpha ? "#b91c1c" : "var(--td)", fontWeight: e.r.alpha ? 700 : 400 }}>
                    {e.r.alpha || "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{jamMenit(e.r.menitLembur)}</td>
                </tr>
              ))}
              {rows.length === 0 && <TabelKosong kolom={10} pesan="Belum ada karyawan di cabang ini." />}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
          Jam kerja standar & toleransi telat diatur di Pengaturan perusahaan.
        </div>
      </div>
    </LaporanPage>
  );
}
