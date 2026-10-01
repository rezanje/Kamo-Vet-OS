import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/employee";
import { pilihSesiAbsensi, waktuSesiWIB, type SesiAbsensi } from "@/lib/attendance-session";
import { AbsensiStaf } from "./AbsensiStaf";
import { CutiForm } from "./CutiForm";
import { PengajuanCards, type Kasbon, type Lembur, type Reimburse } from "./PengajuanCards";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const LEAVE_BADGE: Record<string, string> = { Menunggu: "o", Disetujui: "g", Ditolak: "r" };

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const emp = await getMyEmployee(supabase as never, user.id);
  const now = new Date();
  const wibDate = new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const monthKey = wibDate.slice(0, 7);

  // Quest ringkasan (keying profiles.id — tak butuh employee).
  const [{ data: points }, { data: streak }, { data: qprog }] = await Promise.all([
    supabase.from("staff_points").select("total_points").eq("staff_id", user.id).maybeSingle(),
    supabase.from("staff_streaks").select("current_streak_days").eq("staff_id", user.id).maybeSingle(),
    supabase.from("staff_quest_progress").select("status").eq("staff_id", user.id).neq("status", "in_progress"),
  ]);
  const totalPoin = points?.total_points ?? 0;
  const streakDays = streak?.current_streak_days ?? 0;
  const questSelesai = (qprog ?? []).length;

  // Data HR (butuh employee tertaut).
  let kpi: { metrik: string; target: number | null; realisasi: number | null; skor: number }[] = [];
  let attendanceData: {open_sessions:SesiAbsensi[];today:SesiAbsensi|null;branches:{id:string;name:string}[]} | null = null;
  let attendanceError = "";
  let leaves: { jenis: string; tanggal_mulai: string; tanggal_selesai: string | null; durasi: number | null; status: string }[] = [];
  let lembur: Lembur[] = [];
  let kasbon: Kasbon[] = [];
  let reimburse: Reimburse[] = [];
  if (emp) {
    const [{ data: k }, { data: a, error: sessionError }, { data: l }, { data: ot }, { data: ca }, { data: rb }] = await Promise.all([
      supabase.from("kpi_records").select("metrik, target, realisasi, skor").eq("employee_id", emp.id).eq("periode", monthKey).order("metrik"),
      supabase.rpc("hris_my_attendance"),
      supabase.from("leave_requests").select("jenis, tanggal_mulai, tanggal_selesai, durasi, status").eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("overtime_requests").select("id, tanggal, jam, status").eq("employee_id", emp.id).order("tanggal", { ascending: false }).limit(6),
      supabase.from("cash_advances").select("id, tanggal, jumlah, tenor_bulan, status, cash_advance_installments(jumlah)").eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(4),
      supabase.from("reimbursements").select("id, tanggal, kategori, jumlah, status").eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(6),
    ]);
    kpi = k ?? [];
    attendanceData = a;
    attendanceError = sessionError ? (sessionError.code === "PGRST202" ? "Fitur sesi absensi belum aktif. Hubungi HR." : "Sesi absensi gagal dimuat. Coba muat ulang atau hubungi HR.") : "";
    leaves = l ?? [];
    lembur = (ot ?? []) as Lembur[];
    reimburse = (rb ?? []) as Reimburse[];
    kasbon = ((ca ?? []) as unknown as (Omit<Kasbon, "dibayar"> & { cash_advance_installments: { jumlah: number }[] })[])
      .map((c) => ({
        ...c,
        dibayar: (c.cash_advance_installments ?? []).reduce((a, i) => a + Number(i.jumlah), 0),
      }));
  }
  const session = pilihSesiAbsensi(attendanceData?.open_sessions ?? [],attendanceData?.today ?? null,now.toISOString());

  return (
    <>
      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success === "in" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-login-2" /> Clock-in tercatat. Selamat bekerja!</div>}
      {success === "out" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-logout-2" /> Clock-out tercatat. Sampai jumpa!</div>}
      {success === "lembur" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pengajuan lembur terkirim — menunggu persetujuan.</div>}
      {success === "kasbon" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pengajuan kasbon terkirim — menunggu persetujuan.</div>}
      {success === "reimburse" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pengajuan reimburse terkirim — menunggu persetujuan.</div>}
      {success === "cuti" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pengajuan terkirim — menunggu persetujuan manajer.</div>}

      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--posb)", marginBottom: 4 }}>Halo, {emp?.nama?.split(" ")[0] ?? "Staff"}!</div>
      <div style={{ fontSize: 11.5, color: "var(--tm)", marginBottom: 14 }}>{emp?.jabatan ?? "Staff Kasir"} · ringkasan pribadi kamu hari ini.</div>

      {/* 1. Ringkasan Quest */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)", letterSpacing: ".04em" }}><i className="ti ti-trophy" /> RINGKASAN QUEST</span>
          <Link href="/kasir/quest" className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>Buka Quest Lengkap <i className="ti ti-arrow-right" /></Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          <Stat icon="ti-star" bg="#eff6ff" color="#1d4ed8" label="Total Poin" val={totalPoin.toLocaleString("id-ID")} />
          <Stat icon="ti-flame" bg="#fffbeb" color="#d97706" label="Streak Harian" val={`${streakDays} Hari`} />
          <Stat icon="ti-circle-check" bg="#e8f5ee" color="#15803d" label="Quest Selesai" val={`${questSelesai}`} />
        </div>
      </div>

      {!emp ? (
        <div className="card" style={{ marginBottom: 12, borderColor: "#fcd34d", background: "#fffbeb" }}>
          <div style={{ fontSize: 11.5, color: "#92400e" }}><i className="ti ti-alert-triangle" /> Akun kamu belum tertaut ke data karyawan. Hubungi manajer untuk aktivasi absensi, KPI & pengajuan cuti.</div>
        </div>
      ) : (
        <>
          {/* 2. KPI Pribadi */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)", letterSpacing: ".04em", marginBottom: 8 }}><i className="ti ti-target" /> KPI PRIBADI · {monthKey}</div>
            {kpi.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--td)" }}>Belum ada penilaian KPI bulan ini.</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Metrik</th><th style={{ textAlign: "right" }}>Target</th><th style={{ textAlign: "right" }}>Realisasi</th><th style={{ width: 130 }}>Skor</th></tr></thead>
                <tbody>
                  {kpi.map((k, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{k.metrik}</td>
                      <td style={{ textAlign: "right", fontSize: 11 }}>{k.target != null ? rp(Number(k.target)) : "—"}</td>
                      <td style={{ textAlign: "right", fontSize: 11 }}>{k.realisasi != null ? rp(Number(k.realisasi)) : "—"}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ flex: 1, height: 6, background: "var(--sf1)", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(100, Number(k.skor))}%`, height: "100%", background: "var(--posb)" }} />
                          </div>
                          <span style={{ fontSize: 10.5, fontWeight: 700 }}>{Number(k.skor)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card" style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>SESI ABSENSI</div>
            {attendanceError ? <p role="alert">{attendanceError}</p> : <>
              {session.row && <p>Tanggal masuk: <b>{session.row.tanggal}</b> · Masuk: {session.row.checked_in_at ? waktuSesiWIB(session.row.checked_in_at) : session.row.jam_masuk} · Pulang: {waktuSesiWIB(session.row.checked_out_at)}</p>}
              {session.correction ? <p role="alert">Ada sesi lama atau waktu belum lengkap. Minta HR mengoreksi dengan waktu sebenarnya atau membatalkan sesi yang keliru. Untuk sesi pada gaji yang sudah final, HR dapat melepas blokir absen berikutnya dengan alasan sambil mempertahankan riwayat lama. Jam kerja tidak diisi otomatis.</p> : <AbsensiStaf action={session.action} sessionBranch={session.row?.branch_id ?? undefined} branches={attendanceData?.branches ?? []}/>}
            </>}
          </div>

          {/* 4b. Lembur, kasbon, reimburse */}
          {emp && (
            <PengajuanCards hariIni={wibDate} lembur={lembur} kasbon={kasbon} reimburse={reimburse} />
          )}

          {/* 4. Pengajuan Cuti/Izin */}
          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)", letterSpacing: ".04em", marginBottom: 8 }}><i className="ti ti-calendar-plus" /> PENGAJUAN CUTI / IZIN</div>
            <CutiForm />
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tm)", margin: "12px 0 6px" }}>RIWAYAT PENGAJUAN</div>
            {leaves.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--td)" }}>Belum ada pengajuan.</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Jenis</th><th>Mulai</th><th>Selesai</th><th>Durasi</th><th>Status</th></tr></thead>
                <tbody>
                  {leaves.map((l, i) => (
                    <tr key={i}>
                      <td>{l.jenis}</td>
                      <td style={{ fontSize: 11 }}>{l.tanggal_mulai}</td>
                      <td style={{ fontSize: 11 }}>{l.tanggal_selesai ?? "—"}</td>
                      <td style={{ fontSize: 11 }}>{l.durasi ?? "—"}</td>
                      <td><span className={`bge ${LEAVE_BADGE[l.status] ?? "o"}`}>{l.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}

function Stat({ icon, bg, color, label, val }: { icon: string; bg: string; color: string; label: string; val: string }) {
  return (
    <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: "9px 11px", background: bg }}>
      <i className={`ti ${icon}`} style={{ color, fontSize: 15 }} />
      <div style={{ fontSize: 16, fontWeight: 800, marginTop: 3 }}>{val}</div>
      <div style={{ fontSize: 8.5, color: "var(--tm)" }}>{label}</div>
    </div>
  );
}
