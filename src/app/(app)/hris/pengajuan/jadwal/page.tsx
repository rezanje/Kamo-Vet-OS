import Link from "next/link";
import { assertRole } from "@/lib/master-guard";
import { jamRingkas } from "@/lib/shift-master";
import { type PengajuanJadwal } from "@/lib/schedule-request";
import { SubmitButton } from "@/components/SubmitButton";
import { setujuiPerubahanJadwal, tolakPerubahanJadwal } from "./actions";
export default async function PengajuanJadwalPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await assertRole("/me", "pengajuan jadwal", [
    "OWNER",
    "ADMIN",
  ]);
  const [pending, history] = await Promise.all([
    supabase
      .from("schedule_change_requests")
      .select("*, employees(nama), branches(name)")
      .eq("status", "Menunggu")
      .order("tanggal")
      .order("id")
      .limit(100),
    supabase
      .from("schedule_change_requests")
      .select("*, employees(nama), branches(name)")
      .neq("status", "Menunggu")
      .order("decided_at", { ascending: false })
      .order("id")
      .limit(50),
  ]);
  type Row = PengajuanJadwal & {
    employees: { nama: string } | { nama: string }[] | null;
    branches: { name: string } | { name: string }[] | null;
  };
  const rows = (pending.data ?? []) as Row[];
  const done = (history.data ?? []) as Row[];
  const name = (r: Row) =>
    (Array.isArray(r.employees) ? r.employees[0]?.nama : r.employees?.nama) ??
    "Karyawan";
  const branchName = (r: Row) =>
    (Array.isArray(r.branches) ? r.branches[0]?.name : r.branches?.name) ??
    r.branch_id;
  return (
    <>
      <Link className="back-btn" href="/hris/pengajuan">
        Kembali ke pengajuan karyawan
      </Link>
      <h1>Pengajuan perubahan jadwal</h1>
      <p>
        Persetujuan mengubah satu jadwal dan menyimpan keputusan sekaligus.
        Jadwal/shift yang berubah sejak pengajuan atau absensi yang sudah
        tercatat akan ditolak. Tolak pengajuan usang dengan alasan agar staf
        dapat mengajukan ulang.
      </p>
      {sp.error && <p role="alert">{sp.error}</p>}
      {sp.success && (
        <p role="status">Keputusan dan jejak perubahan tersimpan.</p>
      )}
      {pending.error || history.error ? (
        <p role="alert">
          Pengajuan gagal dimuat atau fitur belum aktif. Tidak ada keputusan
          disimpan.
        </p>
      ) : (
        <>
          <div className="crm-sec">
            <h2>Menunggu keputusan</h2>
            <p>100 pengajuan paling awal yang diizinkan.</p>
            {!rows.length && <p>Tidak ada pengajuan menunggu.</p>}
            {rows.map((r) => (
              <div
                key={r.id}
                style={{
                  padding: "12px 0",
                  borderBottom: "1px solid var(--bd)",
                }}
              >
                <b>
                  {name(r)} · {r.tanggal}
                </b>
                <p>
                  {r.old_shift.nama} ·{" "}
                  {r.old_shift.is_libur
                    ? "Libur"
                    : jamRingkas(
                        r.old_shift.jam_masuk,
                        r.old_shift.jam_pulang,
                      )}{" "}
                  →{" "}
                  <b>
                    {r.proposed_shift.nama} ·{" "}
                    {r.proposed_shift.is_libur
                      ? "Libur"
                      : jamRingkas(
                          r.proposed_shift.jam_masuk,
                          r.proposed_shift.jam_pulang,
                        )}
                  </b>
                </p>
                <p>Cabang: {branchName(r)}</p>
                <p>Alasan staf: {r.reason}</p>
                <form action={setujuiPerubahanJadwal}>
                  <input type="hidden" name="id" value={r.id} />
                  <label className="flab" htmlFor={`reason-${r.id}`}>
                    Alasan keputusan HR
                  </label>
                  <textarea
                    id={`reason-${r.id}`}
                    className="fi"
                    name="reason"
                    required
                    minLength={3}
                    maxLength={1000}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <SubmitButton className="btn-acc" pendingText="Menyimpan…">
                      Setujui perubahan
                    </SubmitButton>
                    <SubmitButton
                      className="btn-def"
                      formAction={tolakPerubahanJadwal}
                      pendingText="Menyimpan…"
                    >
                      Tolak
                    </SubmitButton>
                  </div>
                </form>
              </div>
            ))}
          </div>
          <div className="crm-sec">
            <h2>50 keputusan terakhir</h2>
            {!done.length && <p>Belum ada keputusan.</p>}
            {done.map((r) => (
              <details key={r.id} style={{ marginBottom: 12 }}>
                <summary>
                  {name(r)} · {r.tanggal} · {r.status}
                </summary>
                <p>
                  {r.old_shift.nama} → {r.proposed_shift.nama}
                </p>
                <p>Cabang: {branchName(r)}</p>
                <p>Alasan staf: {r.reason}</p>
                <p>Alasan HR: {r.decision_reason}</p>
                <p>
                  Pelaku: {r.decided_by} ·{" "}
                  {r.decided_at
                    ? new Date(r.decided_at).toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                      })
                    : ""}{" "}
                  WIB
                </p>
              </details>
            ))}
          </div>
        </>
      )}
    </>
  );
}
