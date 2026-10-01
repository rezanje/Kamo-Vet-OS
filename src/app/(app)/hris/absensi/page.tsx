import Link from "next/link";
import { assertRole } from "@/lib/master-guard";
import { aksesCabangHRIS } from "@/lib/jadwal-scope";
import { hariIniWIB } from "@/lib/tanggal";
import { tanggalValid } from "@/lib/jadwal-kalender";
import {
  menitSesi,
  waktuSesiWIB,
  type SesiAbsensi,
} from "@/lib/attendance-session";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanAbsensi, koreksiAbsensi, selesaikanSesiFinal } from "./actions";

type Row = SesiAbsensi & {
  employee_id: string;
  status: string;
  keterangan: string | null;
  attendance_session_resolutions?: {
    attendance_id: string;
    reason: string;
    created_at: string;
  }[];
};
const localValue = (iso: string | null) =>
  iso
    ? new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0, 23)
    : "";
export default async function AbsensiPage({
  searchParams,
}: {
  searchParams: Promise<{ tgl?: string; error?: string; success?: string }>;
}) {
  const supabase = await assertRole("/me", "rincian absensi", [
    "OWNER",
    "ADMIN",
  ]);
  const sp = await searchParams;
  const date = tanggalValid(sp.tgl) ? sp.tgl : hariIniWIB();
  const access = await aksesCabangHRIS(supabase);
  const [emps, assignments, daily, open, audit] = await Promise.all([
    supabase
      .from("employees")
      .select("id, nama, jabatan, branch_id")
      .order("nama"),
    supabase
      .from("employee_branch_assignments")
      .select("employee_id, branch_id, effective_date"),
    supabase
      .from("attendance")
      .select(
        "*, attendance_session_resolutions(attendance_id, reason, created_at)",
      )
      .eq("tanggal", date)
      .order("employee_id"),
    supabase
      .from("hris_open_attendance")
      .select("*")
      .lt("tanggal", hariIniWIB())
      .order("tanggal")
      .limit(100),
    supabase
      .from("attendance_corrections")
      .select(
        "id, employee_id, actor_id, reason, old_values, new_values, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const allowed = new Set(access.branches.map((b) => b.id));
  const employees = (emps.data ?? []).filter(
    (e) =>
      access.role === "OWNER" ||
      ((assignments.data ?? []).some(
        (a) =>
          a.employee_id === e.id &&
          a.branch_id === e.branch_id &&
          a.effective_date <= hariIniWIB(),
      ) &&
        (assignments.data ?? [])
          .filter((a) => a.employee_id === e.id)
          .every(
            (a) => allowed.has(a.branch_id) && a.effective_date <= hariIniWIB(),
          )),
  );
  const names = new Map((emps.data ?? []).map((e) => [e.id, e.nama]));
  const loadError =
    emps.error || assignments.error || daily.error || open.error || audit.error;
  const rows = (daily.data ?? []) as Row[];
  const unresolved = (open.data ?? []) as Row[];
  return (
    <>
      <Link className="back-btn" href="/hris">
        Kembali ke HRIS
      </Link>
      {sp.error && (
        <p role="alert" className="p2ban">
          {sp.error}
        </p>
      )}
      {sp.success && (
        <p role="status" className="p2ban">
          Catatan dan jejak perubahan tersimpan.
        </p>
      )}
      {loadError ? (
        <p role="alert">
          Sesi absensi atau akses gagal dimuat. Fitur mungkin belum aktif;
          hubungi admin sistem. Tidak ada perubahan disimpan.
        </p>
      ) : (
        <>
          <div className="crm-sec">
            <SecHeader
              num="01"
              title="CATAT ABSENSI"
              desc="Tambah catatan yang belum ada. Untuk perubahan catatan lama, gunakan koreksi berjejak di tabel."
            />
            <form action={simpanAbsensi}>
              <div className="grid2">
                <div>
                  <label htmlFor="attendance-employee" className="flab">
                    Karyawan
                  </label>
                  <select
                    id="attendance-employee"
                    className="fi"
                    name="employee_id"
                    required
                  >
                    <option value="">Pilih karyawan di cabang diizinkan</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nama}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="attendance-date" className="flab">
                    Tanggal masuk / catatan
                  </label>
                  <input
                    id="attendance-date"
                    className="fi"
                    type="date"
                    name="tanggal"
                    defaultValue={date}
                    required
                    max={hariIniWIB()}
                  />
                </div>
                <div>
                  <label htmlFor="attendance-in" className="flab">
                    Jam masuk WIB (Hadir)
                  </label>
                  <input
                    id="attendance-in"
                    className="fi"
                    type="time"
                    name="jam_masuk"
                  />
                </div>
                <div>
                  <label htmlFor="attendance-out-date" className="flab">
                    Tanggal pulang (jika ada)
                  </label>
                  <input
                    id="attendance-out-date"
                    className="fi"
                    type="date"
                    name="tanggal_pulang"
                    defaultValue={date}
                  />
                </div>
                <div>
                  <label htmlFor="attendance-out" className="flab">
                    Jam pulang WIB
                  </label>
                  <input
                    id="attendance-out"
                    className="fi"
                    type="time"
                    name="jam_pulang"
                  />
                </div>
                <div>
                  <label htmlFor="attendance-status" className="flab">
                    Status
                  </label>
                  <select id="attendance-status" className="fi" name="status">
                    {["Hadir", "Izin", "Sakit", "Alpha", "Cuti"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="attendance-reason" className="flab">
                    Alasan / sumber catatan
                  </label>
                  <input
                    id="attendance-reason"
                    className="fi"
                    name="keterangan"
                    required
                    minLength={3}
                    maxLength={1000}
                  />
                </div>
              </div>
              <p>Untuk status selain Hadir, kosongkan jam masuk dan pulang.</p>
              <SubmitButton className="btn-acc" pendingText="Menyimpan…">
                Simpan catatan baru
              </SubmitButton>
            </form>
          </div>
          <div className="crm-sec">
            <SecHeader
              num="02"
              title="ABSENSI HARIAN"
              desc={`Tanggal masuk ${date}. Durasi hanya dihitung dari timestamp lengkap.`}
              action={
                <form method="get" style={{ display: "flex", gap: 8 }}>
                  <input
                    aria-label="Tanggal absensi"
                    className="fi"
                    name="tgl"
                    type="date"
                    defaultValue={date}
                  />
                  <button className="btn-def">Tampilkan</button>
                </form>
              }
            />
            <AttendanceTable rows={rows} names={names} date={date} />
          </div>
          <div className="crm-sec">
            <SecHeader
              num="03"
              title="SESI SEBELUMNYA BELUM SELESAI"
              desc="Maksimal 100 sesi terbuka sebelum hari ini. Pulang lintas hari dicatat pada sesi masuk; sesi lama/legacy membutuhkan koreksi eksplisit."
            />
            <AttendanceTable rows={unresolved} names={names} date={date} />
          </div>
          <div className="crm-sec">
            <SecHeader
              num="04"
              title="JEJAK KOREKSI"
              desc="50 perubahan terakhir yang diizinkan. Nilai lama tetap disimpan."
            />
            {!(audit.data ?? []).length ? (
              <p>Belum ada koreksi.</p>
            ) : (
              (audit.data ?? []).map((a) => (
                <details key={a.id} style={{ marginBottom: 12 }}>
                  <summary>
                    {names.get(a.employee_id) ?? "Karyawan"} ·{" "}
                    {waktuSesiWIB(a.created_at)} · {a.reason}
                  </summary>
                  <p>Pelaku: {a.actor_id}</p>
                  <div className="grid2">
                    <div>
                      <b>Sebelum</b>
                      <pre style={{ whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(a.old_values, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <b>Sesudah</b>
                      <pre style={{ whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(a.new_values, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}
function AttendanceTable({
  rows,
  names,
  date,
}: {
  rows: Row[];
  names: Map<string, string>;
  date: string;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Karyawan</th>
            <th>Tanggal masuk</th>
            <th>Masuk WIB</th>
            <th>Pulang WIB</th>
            <th>Durasi / keadaan</th>
            <th>Koreksi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const minutes = menitSesi(r);
            return (
              <tr key={r.id}>
                <td>{names.get(r.employee_id) ?? "Karyawan"}</td>
                <td>{r.tanggal}</td>
                <td>
                  {r.checked_in_at
                    ? waktuSesiWIB(r.checked_in_at)
                    : (r.jam_masuk ?? "—")}
                </td>
                <td>
                  {r.checked_out_at
                    ? waktuSesiWIB(r.checked_out_at)
                    : (r.jam_pulang ?? "—")}
                </td>
                <td>
                  {r.attendance_session_resolutions?.length
                    ? "Sesi lama dilepas dari blokir; catatan tetap"
                    : r.is_void
                      ? "Dibatalkan"
                      : minutes !== null
                        ? `${Math.floor(minutes / 60)}j ${minutes % 60}m`
                        : r.status === "Hadir"
                          ? "Belum lengkap / perlu verifikasi"
                          : r.status}
                </td>
                <td>
                  {r.attendance_session_resolutions?.length ? (
                    <p>Alasan: {r.attendance_session_resolutions[0].reason}</p>
                  ) : (
                    <>
                      <details>
                        <summary>Koreksi berjejak</summary>
                        <form action={koreksiAbsensi} style={{ minWidth: 250 }}>
                          <input type="hidden" name="id" value={r.id} />
                          <input
                            type="hidden"
                            name="updated_at"
                            value={r.updated_at ?? ""}
                          />
                          <input
                            type="hidden"
                            name="checked_in_at_original"
                            value={r.checked_in_at ?? ""}
                          />
                          <input
                            type="hidden"
                            name="checked_out_at_original"
                            value={r.checked_out_at ?? ""}
                          />
                          <input type="hidden" name="tgl" value={date} />
                          <label className="flab" htmlFor={`in-${r.id}`}>
                            Masuk WIB sebenarnya
                          </label>
                          <input
                            id={`in-${r.id}`}
                            className="fi"
                            name="checked_in_at"
                            type="datetime-local"
                            step="any"
                            defaultValue={localValue(r.checked_in_at)}
                          />
                          <label className="flab" htmlFor={`out-${r.id}`}>
                            Pulang WIB sebenarnya (sesi tanpa cabang wajib
                            dilengkapi atau dibatalkan)
                          </label>
                          <input
                            id={`out-${r.id}`}
                            className="fi"
                            name="checked_out_at"
                            type="datetime-local"
                            step="any"
                            defaultValue={localValue(r.checked_out_at)}
                          />
                          <label>
                            <input type="checkbox" name="void" value="1" />{" "}
                            Batalkan sesi yang keliru; jangan mengarang jam
                          </label>
                          <label className="flab" htmlFor={`reason-${r.id}`}>
                            Alasan koreksi
                          </label>
                          <input
                            id={`reason-${r.id}`}
                            className="fi"
                            name="reason"
                            required
                            minLength={3}
                            maxLength={1000}
                          />
                          <SubmitButton
                            className="btn-acc"
                            pendingText="Menyimpan…"
                          >
                            Simpan koreksi
                          </SubmitButton>
                        </form>
                      </details>
                      {r.jam_masuk &&
                        !r.jam_pulang &&
                        !r.is_void &&
                        r.tanggal < hariIniWIB() && (
                          <details>
                            <summary>
                              Izinkan absen berikutnya (gaji final)
                            </summary>
                            <p>
                              Hanya untuk sesi terbuka dari hari sebelumnya yang
                              periode gajinya sudah disahkan. Catatan ini dan
                              gaji final tetap dipertahankan; waktu kerja belum
                              lengkap. Alasan wajib dicatat.
                            </p>
                            <form action={selesaikanSesiFinal}>
                              <input type="hidden" name="id" value={r.id} />
                              <input
                                type="hidden"
                                name="updated_at"
                                value={r.updated_at ?? ""}
                              />
                              <input type="hidden" name="tgl" value={date} />
                              <label
                                className="flab"
                                htmlFor={`resolve-${r.id}`}
                              >
                                Alasan melepas blokir
                              </label>
                              <input
                                id={`resolve-${r.id}`}
                                className="fi"
                                name="reason"
                                required
                                minLength={3}
                                maxLength={1000}
                              />
                              <SubmitButton
                                className="btn-acc"
                                pendingText="Menyimpan…"
                              >
                                Lepas blokir sesi final
                              </SubmitButton>
                            </form>
                          </details>
                        )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={6}>Tidak ada catatan.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
