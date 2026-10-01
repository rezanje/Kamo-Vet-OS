import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";
import { geserTanggal, tanggalValid } from "@/lib/jadwal-kalender";
import { jamRingkas } from "@/lib/shift-master";
import { pesanJadwal, type DataJadwalSaya } from "@/lib/schedule-request";
import { PerubahanJadwalForm } from "./PerubahanJadwalForm";
export default async function JadwalSayaPage({
  searchParams,
}: {
  searchParams: Promise<{
    dari?: string;
    sampai?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const today = hariIniWIB();
  const start = tanggalValid(sp.dari) ? sp.dari : today;
  const end = tanggalValid(sp.sampai) ? sp.sampai : geserTanggal(start, 30);
  const { data, error } = await supabase.rpc("hris_my_schedule", {
    p_start: start,
    p_end: end,
  });
  const schedule = data as DataJadwalSaya | null;
  return (
    <>
      <Link className="back-btn" href="/me">
        Kembali ke dashboard pribadi
      </Link>
      <h1>Jadwal & pengajuan perubahan</h1>
      <p>
        Ajukan shift lain untuk jadwal yang sudah tersedia hari ini atau
        berikutnya. Jadwal berubah setelah HR menyetujui, sebelum absensi
        tercatat. Hubungi HR untuk koreksi hari yang sudah lewat.
      </p>
      {sp.error && <p role="alert">{sp.error}</p>}
      {sp.success && (
        <p role="status">Pengajuan tersimpan, menunggu keputusan HR.</p>
      )}
      <form method="get" className="grid2">
        <div>
          <label className="flab" htmlFor="from">
            Dari
          </label>
          <input
            id="from"
            className="fi"
            type="date"
            name="dari"
            defaultValue={start}
          />
        </div>
        <div>
          <label className="flab" htmlFor="until">
            Sampai (maksimal 62 hari)
          </label>
          <input
            id="until"
            className="fi"
            type="date"
            name="sampai"
            defaultValue={end}
          />
        </div>
        <button className="btn-def">Tampilkan</button>
      </form>
      {error || !schedule ? (
        <p role="alert">
          {error
            ? pesanJadwal(error)
            : "Jadwal gagal dimuat. Muat ulang atau hubungi HR."}
        </p>
      ) : (
        <>
          <div className="crm-sec">
            <h2>Jadwal berlaku</h2>
            {!schedule.schedules.length && (
              <p>
                Belum ada jadwal pada rentang ini. Hubungi HR untuk penjadwalan.
              </p>
            )}
            {schedule.schedules.map((row) => {
              const pending = schedule.requests.find(
                (r) => r.tanggal === row.tanggal && r.status === "Menunggu",
              );
              return (
                <details
                  key={`${row.id}|${row.updated_at}`}
                  style={{ marginBottom: 12 }}
                >
                  <summary>
                    {row.tanggal} · {row.shift.nama} ·{" "}
                    {row.shift.is_libur
                      ? "Libur"
                      : jamRingkas(row.shift.jam_masuk, row.shift.jam_pulang)}
                  </summary>
                  {pending ? (
                    <p>
                      Pengajuan {pending.proposed_shift.nama} menunggu HR;
                      jadwal di atas masih berlaku.
                    </p>
                  ) : row.tanggal < today ? (
                    <p>Tanggal sudah lewat. Koreksi melalui HR.</p>
                  ) : (
                    <PerubahanJadwalForm
                      row={row}
                      branches={schedule.branches}
                      shifts={schedule.shifts}
                    />
                  )}
                </details>
              );
            })}
          </div>
          <div className="crm-sec">
            <h2>Riwayat pengajuan</h2>
            <p>
              Pengajuan pada rentang ini dan 50 pengajuan terakhir. Keputusan
              lama tetap tersimpan.
            </p>
            {!schedule.requests.length && <p>Belum ada pengajuan.</p>}
            {schedule.requests.map((r) => (
              <details key={r.id} style={{ marginBottom: 12 }}>
                <summary>
                  {r.tanggal} · {r.old_shift.nama} → {r.proposed_shift.nama} ·{" "}
                  {r.status}
                </summary>
                <p>
                  Usulan:{" "}
                  {r.proposed_shift.is_libur
                    ? "Libur"
                    : jamRingkas(
                        r.proposed_shift.jam_masuk,
                        r.proposed_shift.jam_pulang,
                      )}
                </p>
                <p>Alasan: {r.reason}</p>
                {r.decision_reason && (
                  <p>
                    Keputusan HR: {r.decision_reason} ·{" "}
                    {r.decided_at
                      ? new Date(r.decided_at).toLocaleString("id-ID", {
                          timeZone: "Asia/Jakarta",
                        })
                      : ""}
                  </p>
                )}
              </details>
            ))}
          </div>
        </>
      )}
    </>
  );
}
