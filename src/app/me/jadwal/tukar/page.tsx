import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";
import { geserTanggal, tanggalValid } from "@/lib/jadwal-kalender";
import {
  pesanJadwal,
  pilihanCabangJadwal,
  type DataJadwalSaya,
} from "@/lib/schedule-request";
import type { KandidatTukar, TukarShift } from "@/lib/schedule-swap";
import { jamRingkas } from "@/lib/shift-master";
import { SubmitButton } from "@/components/SubmitButton";
import {
  ajukanTukarShift,
  terimaTukarShift,
  tolakTukarShift,
  batalkanTukarShift,
} from "./actions";
export default async function TukarPage({
  searchParams,
}: {
  searchParams: Promise<{
    own?: string;
    branch?: string;
    dari?: string;
    sampai?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const sp = await searchParams;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const today = hariIniWIB();
  const start = tanggalValid(sp.dari) ? sp.dari : today;
  const end = tanggalValid(sp.sampai) ? sp.sampai : geserTanggal(start, 30);
  const [ownData, history] = await Promise.all([
    db.rpc("hris_my_schedule", { p_start: start, p_end: end }),
    db.rpc("hris_my_schedule_swaps", { p_start: start, p_end: end }),
  ]);
  const own = ownData.data as DataJadwalSaya | null;
  const rows = (history.data ?? []) as TukarShift[];
  const chosen = own?.schedules.find(
    (r) => r.id === sp.own && r.tanggal >= today,
  );
  const branches = chosen
    ? pilihanCabangJadwal(chosen, own?.branches ?? [])
    : [];
  const branch = branches.some((b) => b.id === sp.branch)
    ? sp.branch
    : branches[0]?.id;
  const peers =
    chosen && branch
      ? await db.rpc("hris_swap_candidates", {
          p_schedule_id: chosen.id,
          p_branch_id: branch,
          p_start: start,
          p_end: end,
        })
      : null;
  const candidates = (peers?.data ?? []) as KandidatTukar[];
  const shiftText = (s: KandidatTukar["shift"]) =>
    `${s.nama} · ${s.is_libur ? "Libur" : jamRingkas(s.jam_masuk, s.jam_pulang)}`;
  return (
    <>
      <Link href="/me/jadwal" className="back-btn">
        Kembali ke jadwal
      </Link>
      <h1>Tukar shift dengan rekan</h1>
      <p>
        Rekan menyetujui dulu, lalu HR memutuskan. Dua jadwal berubah sekaligus
        setelah disetujui; sebelum itu jadwal lama tetap berlaku.
      </p>
      {sp.error && <p role="alert">{sp.error}</p>}
      {sp.success && <p role="status">Pengajuan atau jawaban tersimpan.</p>}
      {ownData.error || history.error ? (
        <p role="alert">{pesanJadwal(ownData.error ?? history.error!)}</p>
      ) : (
        <>
          <form method="get" className="grid2">
            <label>
              Dari
              <input
                className="fi"
                type="date"
                name="dari"
                defaultValue={start}
              />
            </label>
            <label>
              Sampai (maksimal 62 hari)
              <input
                className="fi"
                type="date"
                name="sampai"
                defaultValue={end}
              />
            </label>
            <label>
              Jadwal sendiri
              <select
                className="fi"
                name="own"
                defaultValue={chosen?.id ?? ""}
                required
              >
                <option value="">Pilih jadwal</option>
                {own?.schedules
                  .filter((r) => r.tanggal >= today)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.tanggal} · {shiftText(r.shift)}
                    </option>
                  ))}
              </select>
            </label>
            {chosen && (
              <label>
                Cabang
                <select className="fi" name="branch" defaultValue={branch}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="btn-def">Cari jadwal rekan</button>
          </form>
          {peers?.error && <p role="alert">{pesanJadwal(peers.error)}</p>}
          {chosen && branch && !peers?.error && (
            <div className="crm-sec">
              <h2>Jadwal rekan yang dapat ditukar</h2>
              <p>
                Jadwal kamu: {chosen.tanggal} · {shiftText(chosen.shift)}.
                Pilihan hanya dari penugasan cabang yang sesuai.
              </p>
              {!candidates.length && (
                <p>
                  Tidak ada jadwal rekan yang sesuai. Coba rentang atau jadwal
                  lain.
                </p>
              )}
              {candidates.map((p) => (
                <details key={p.id} style={{ marginBottom: 12 }}>
                  <summary>
                    {p.nama} · {p.tanggal} · {shiftText(p.shift)}
                  </summary>
                  <p>
                    Kamu pada {chosen.tanggal}: {shiftText(chosen.shift)} →{" "}
                    {shiftText(p.shift)}
                    <br />
                    {p.nama} pada {p.tanggal}: {shiftText(p.shift)} →{" "}
                    {shiftText(chosen.shift)}
                  </p>
                  <form action={ajukanTukarShift}>
                    <input type="hidden" name="own_id" value={chosen.id} />
                    <input
                      type="hidden"
                      name="own_version"
                      value={chosen.updated_at}
                    />
                    <input type="hidden" name="peer_id" value={p.id} />
                    <input
                      type="hidden"
                      name="peer_version"
                      value={p.updated_at}
                    />
                    <input type="hidden" name="branch_id" value={branch} />
                    <label>
                      Alasan tukar
                      <textarea
                        className="fi"
                        name="reason"
                        required
                        minLength={3}
                        maxLength={1000}
                      />
                    </label>
                    <SubmitButton className="btn-acc" pendingText="Mengajukan…">
                      Minta persetujuan rekan
                    </SubmitButton>
                  </form>
                </details>
              ))}
            </div>
          )}
          <div className="crm-sec">
            <h2>Pengajuan dan riwayat tukar shift</h2>
            <p>Pengajuan pada rentang ini dan 50 terakhir.</p>
            {!rows.length && <p>Belum ada pengajuan.</p>}
            {rows.map((r) => (
              <details
                key={r.id}
                style={{ marginBottom: 12 }}
                open={r.status.startsWith("Menunggu")}
              >
                <summary>
                  {r.name_a} ({r.date_a}) ↔ {r.name_b} ({r.date_b}) ·{" "}
                  {r.status}
                </summary>
                <p>
                  {r.name_a}: {shiftText(r.shift_a)} → {shiftText(r.shift_b)}
                  <br />
                  {r.name_b}: {shiftText(r.shift_b)} → {shiftText(r.shift_a)}
                </p>
                <p>Alasan: {r.reason}</p>
                {r.peer_reason && <p>Jawaban rekan: {r.peer_reason}</p>}
                {r.decision_reason && <p>Keputusan: {r.decision_reason}</p>}
                {((r.profile_b === user.id && r.status === "Menunggu rekan") ||
                  (r.profile_a === user.id &&
                    r.status.startsWith("Menunggu"))) && (
                  <form
                    action={
                      r.profile_b === user.id
                        ? terimaTukarShift
                        : batalkanTukarShift
                    }
                  >
                    <input type="hidden" name="id" value={r.id} />
                    <label>
                      Alasan jawaban
                      <textarea
                        className="fi"
                        name="reason"
                        required
                        minLength={3}
                        maxLength={1000}
                      />
                    </label>
                    {r.profile_b === user.id ? (
                      <>
                        <SubmitButton className="btn-acc">
                          Setuju, lanjut ke HR
                        </SubmitButton>{" "}
                        <SubmitButton
                          className="btn-def"
                          formAction={tolakTukarShift}
                        >
                          Tolak
                        </SubmitButton>
                      </>
                    ) : (
                      <SubmitButton className="btn-def">
                        Batalkan pengajuan
                      </SubmitButton>
                    )}
                  </form>
                )}
              </details>
            ))}
          </div>
        </>
      )}
    </>
  );
}
