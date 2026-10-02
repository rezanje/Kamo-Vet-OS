import Link from "next/link";
import { assertRole } from "@/lib/master-guard";
import { loadAttendanceRecap } from "@/lib/attendance-recap-server";
import { hariIniWIB } from "@/lib/tanggal";
import { aksesCabangHRIS } from "@/lib/jadwal-scope";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
const duration = (v: number) => `${Math.floor(v / 60)}j ${Math.floor(v % 60)}m`;
export default async function LaporanAbsensiPage({
  searchParams,
}: {
  searchParams: Promise<{
    periode?: string;
    cabang?: string;
    tanggal?: string;
  }>;
}) {
  const sp = await searchParams;
  const db = await assertRole("/me", "rekap absensi", ["OWNER", "ADMIN"]);
  let report: Awaited<ReturnType<typeof loadAttendanceRecap>> | null = null;
  let error = "";
  try {
    report = await loadAttendanceRecap(db, sp);
  } catch (e) {
    error = e instanceof Error ? e.message : "Rekap gagal dimuat";
  }
  const access = report?.access ?? (await aksesCabangHRIS(db));
  const period = report?.period ?? sp.periode ?? hariIniWIB().slice(0, 7);
  const branch = report?.branch ?? sp.cabang ?? "";
  const summary = report?.result.summaries ?? [];
  const daily = (report?.result.daily ?? []).filter(
    (d) => !sp.tanggal || d.tanggal === sp.tanggal,
  );
  const branches = new Map(access.branches.map((b) => [b.id, b.name]));
  return (
    <LaporanPage
      icon="ti-clock-check"
      title="REKAP ABSENSI"
      desc="Berdasarkan jadwal yang berlaku, sesi masuk–pulang dan pengajuan yang disetujui. Angka keterlambatan adalah fakta waktu; aturan potongan gaji tetap terpisah."
      filter={
        <>
          <label>
            Periode
            <input
              className="fi"
              type="month"
              name="periode"
              defaultValue={period}
            />
          </label>
          <label>
            Cabang
            <select className="fi" name="cabang" defaultValue={branch}>
              {access.role === "OWNER" && (
                <option value="">Semua cabang</option>
              )}
              {access.branches.map((b) => (
                <option value={b.id} key={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-def">Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka
          items={[
            { label: "Karyawan dengan catatan", nilai: String(summary.length) },
            {
              label: "Hari telat",
              nilai: String(summary.reduce((s, r) => s + r.hariTelat, 0)),
            },
            {
              label: "Alpha hari lewat",
              nilai: String(summary.reduce((s, r) => s + r.bolos, 0)),
            },
            {
              label: "Hari perlu koreksi",
              nilai: String(summary.reduce((s, r) => s + r.hariBermasalah, 0)),
            },
          ]}
        />
      }
    >
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          <Link
            className="btn-def"
            href={`/laporan/absensi/export?${new URLSearchParams({ periode: period, cabang: branch })}`}
          >
            Ekspor Excel ringkasan & harian
          </Link>
          <p>
            Durasi hanya dijumlahkan untuk timestamp lengkap. Jam legacy yang
            belum pasti ditampilkan terpisah. Lembur dibayar hanya dari
            pengajuan yang disetujui.
          </p>
          <div className="crm-sec" style={{ overflowX: "auto" }}>
            <h2>Ringkasan bulanan</h2>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Karyawan</th>
                  <th>Terjadwal</th>
                  <th>Hadir</th>
                  <th>Alpha</th>
                  <th>Cuti / izin / sakit</th>
                  <th>Telat</th>
                  <th>Durasi diketahui</th>
                  <th>Hari durasi belum pasti</th>
                  <th>Lembur disetujui</th>
                  <th>Perlu koreksi</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((r) => (
                  <tr key={r.employeeId}>
                    <td>{r.nama}</td>
                    <td>{r.hariKerja}</td>
                    <td>{r.hadir}</td>
                    <td>{r.bolos}</td>
                    <td>
                      {r.cuti} / {r.izin} / {r.sakit}
                    </td>
                    <td>
                      {r.hariTelat} hari · {(r.detikTelat / 60).toFixed(2)}{" "}
                      menit
                    </td>
                    <td>{duration(r.menitKerja)}</td>
                    <td>{r.hariJamTidakDiketahui}</td>
                    <td>{duration(r.menitLemburDisetujui)}</td>
                    <td>{r.hariBermasalah}</td>
                  </tr>
                ))}
                {!summary.length && (
                  <TabelKosong
                    kolom={10}
                    pesan="Tidak ada jadwal atau catatan pada periode ini."
                  />
                )}
              </tbody>
            </table>
          </div>
          <div className="crm-sec">
            <h2>Rincian harian</h2>
            <form method="get">
              <input type="hidden" name="periode" value={period} />
              <input type="hidden" name="cabang" value={branch} />
              <label>
                Tanggal (kosong untuk seluruh bulan)
                <input
                  className="fi"
                  type="date"
                  name="tanggal"
                  defaultValue={sp.tanggal}
                />
              </label>
              <button className="btn-def">Lihat harian</button>
            </form>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Tanggal masuk</th>
                    <th>Karyawan</th>
                    <th>Cabang</th>
                    <th>Shift berlaku</th>
                    <th>Status</th>
                    <th>Masuk / pulang</th>
                    <th>Durasi</th>
                    <th>Telat</th>
                    <th>Lembur disetujui</th>
                    <th>Perlu koreksi</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((r) => (
                    <tr key={`${r.employeeId}|${r.tanggal}`}>
                      <td>{r.tanggal}</td>
                      <td>{r.nama}</td>
                      <td>
                        {r.branchId
                          ? (branches.get(r.branchId) ?? r.branchId)
                          : "Belum pasti"}
                      </td>
                      <td>{r.shift}</td>
                      <td>{r.status}</td>
                      <td>
                        {r.masuk ?? "—"}
                        <br />
                        {r.pulang ?? "—"}
                      </td>
                      <td>
                        {r.menitKerja === null
                          ? "Belum diketahui"
                          : duration(r.menitKerja)}
                      </td>
                      <td>{r.detikTelat.toFixed(0)} detik</td>
                      <td>{duration(r.menitLemburDisetujui)}</td>
                      <td>{r.flags.join("; ") || "—"}</td>
                    </tr>
                  ))}
                  {!daily.length && (
                    <TabelKosong kolom={10} pesan="Tidak ada catatan harian." />
                  )}
                </tbody>
              </table>
            </div>
            <Link href="/hris/absensi">Koreksi catatan melalui HR</Link>
          </div>
        </>
      )}
    </LaporanPage>
  );
}
