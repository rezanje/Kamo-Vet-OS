import Link from "next/link";
import { assertRole } from "@/lib/master-guard";
import { jamRingkas } from "@/lib/shift-master";
import type { TukarShift } from "@/lib/schedule-swap";
import { SubmitButton } from "@/components/SubmitButton";
import { setujuiTukarShift, tolakTukarShiftHR } from "./actions";
export default async function TukarHRPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const sp = await searchParams;
  const db = await assertRole("/me", "pengajuan tukar shift", [
    "OWNER",
    "ADMIN",
  ]);
  const [pending, history] = await Promise.all([
    db
      .from("schedule_swap_requests")
      .select("*")
      .in("status", ["Menunggu rekan", "Menunggu HR"])
      .order("created_at")
      .order("id")
      .limit(100),
    db
      .from("schedule_swap_requests")
      .select("*")
      .not("status", "in", '("Menunggu rekan","Menunggu HR")')
      .order("decided_at", { ascending: false })
      .order("id")
      .limit(50),
  ]);
  const text = (s: TukarShift["shift_a"]) =>
    `${s.nama} · ${s.is_libur ? "Libur" : jamRingkas(s.jam_masuk, s.jam_pulang)}`;
  const detail = (r: TukarShift) => (
    <>
      <p>
        {r.name_a} ({r.date_a}): {text(r.shift_a)} → {text(r.shift_b)}
        <br />
        {r.name_b} ({r.date_b}): {text(r.shift_b)} → {text(r.shift_a)}
      </p>
      <p>Alasan: {r.reason}</p>
      {r.peer_reason && <p>Jawaban rekan: {r.peer_reason}</p>}
      {r.decision_reason && (
        <p>
          Keputusan: {r.decision_reason} · {r.decided_by} ·{" "}
          {r.decided_at
            ? new Date(r.decided_at).toLocaleString("id-ID", {
                timeZone: "Asia/Jakarta",
              })
            : ""}{" "}
          WIB
        </p>
      )}
    </>
  );
  return (
    <>
      <Link href="/hris/pengajuan" className="back-btn">
        Kembali ke pengajuan
      </Link>
      <h1>Persetujuan tukar shift</h1>
      <p>
        Dua jadwal berubah bersama. Persetujuan menunggu jawaban rekan; HR dapat
        menolak pengajuan yang usang.
      </p>
      {sp.error && <p role="alert">{sp.error}</p>}
      {sp.success && <p role="status">Keputusan dan jejaknya tersimpan.</p>}
      {pending.error || history.error ? (
        <p role="alert">Pengajuan gagal dimuat atau fitur belum aktif.</p>
      ) : (
        <>
          <div className="crm-sec">
            <h2>100 pengajuan menunggu paling awal</h2>
            {!pending.data?.length && <p>Tidak ada pengajuan.</p>}
            {(pending.data as TukarShift[]).map((r) => (
              <details key={r.id} open>
                <summary>
                  {r.name_a} ↔ {r.name_b} · {r.status}
                </summary>
                {detail(r)}
                <form action={setujuiTukarShift}>
                  <input type="hidden" name="id" value={r.id} />
                  <label>
                    Alasan keputusan HR
                    <textarea
                      className="fi"
                      name="reason"
                      required
                      minLength={3}
                      maxLength={1000}
                    />
                  </label>
                  <SubmitButton
                    className="btn-acc"
                    disabled={r.status !== "Menunggu HR"}
                  >
                    Setujui kedua jadwal
                  </SubmitButton>{" "}
                  <SubmitButton
                    className="btn-def"
                    formAction={tolakTukarShiftHR}
                  >
                    Tolak
                  </SubmitButton>
                </form>
              </details>
            ))}
          </div>
          <div className="crm-sec">
            <h2>50 keputusan terakhir</h2>
            {(history.data as TukarShift[]).map((r) => (
              <details key={r.id}>
                <summary>
                  {r.name_a} ↔ {r.name_b} · {r.status}
                </summary>
                {detail(r)}
              </details>
            ))}
          </div>
        </>
      )}
    </>
  );
}
