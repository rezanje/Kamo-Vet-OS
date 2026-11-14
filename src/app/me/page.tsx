import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/employee";
import { tombolAbsen, type BarisAbsenSaya } from "@/lib/absensi-mandiri";
import { jamRingkas } from "@/lib/shift-master";
import { geserHari } from "@/lib/tanggal";
import { absenMandiri, ubahPasswordPribadi } from "./actions";
import { AbsenMandiri } from "./AbsenMandiri";
import { KoreksiAbsenForm, type KoreksiSaya } from "./KoreksiAbsenForm";
import { CutiForm } from "./CutiForm";
import { PengajuanCards, type Kasbon, type Lembur, type Reimburse } from "./PengajuanCards";
import { PasswordForm } from "./PasswordForm";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const LEAVE_BADGE: Record<string, string> = { Menunggu: "o", Disetujui: "g", Ditolak: "r" };

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; info?: string }>;
}) {
  const { error, success, info } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const emp = await getMyEmployee(supabase as never, user.id);
  const now = new Date();
  const wibDate = new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const monthKey = wibDate.slice(0, 7);
  const kemarin = geserHari(wibDate, -1);
  const [thn, bln] = monthKey.split("-").map(Number);
  const akhirBulanIni = `${monthKey}-${String(new Date(thn, bln, 0).getDate()).padStart(2, "0")}`;

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
  let absenSaya: BarisAbsenSaya[] = [];
  let jadwal: JadwalSaya[] = [];
  let koreksi: KoreksiSaya[] = [];
  let leaves: { jenis: string; tanggal_mulai: string; tanggal_selesai: string | null; durasi: number | null; status: string }[] = [];
  let lembur: Lembur[] = [];
  let kasbon: Kasbon[] = [];
  let reimburse: Reimburse[] = [];
  if (emp) {
    const [{ data: k }, { data: a }, { data: l }, { data: ot }, { data: ca }, { data: rb }] = await Promise.all([
      supabase.from("kpi_records").select("metrik, target, realisasi, skor").eq("employee_id", emp.id).eq("periode", monthKey).order("metrik"),
      bacaAbsenSaya(supabase, emp.id, kemarin, wibDate),
      supabase.from("leave_requests").select("jenis, tanggal_mulai, tanggal_selesai, durasi, status").eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("overtime_requests").select("id, tanggal, jam, status").eq("employee_id", emp.id).order("tanggal", { ascending: false }).limit(6),
      supabase.from("cash_advances").select("id, tanggal, jumlah, tenor_bulan, status, cash_advance_installments(jumlah)").eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(4),
      supabase.from("reimbursements").select("id, tanggal, kategori, jumlah, status").eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(6),
    ]);
    kpi = k ?? [];
    absenSaya = a;
    const [{ data: j }, { data: kr, error: krError }] = await Promise.all([
      supabase.from("employee_schedules").select("tanggal, work_shifts(nama, jam_masuk, jam_pulang, is_libur, warna)")
        .eq("employee_id", emp.id).gte("tanggal", `${monthKey}-01`).lte("tanggal", akhirBulanIni).order("tanggal"),
      // C1: tabel koreksi belum ada (aplikasi rilis sebelum migrasi) = daftar kosong, halaman tetap jalan.
      supabase.from("attendance_corrections").select("id, tanggal, jam_masuk, jam_pulang, kategori, status, catatan_penyetuju")
        .eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(5),
    ]);
    jadwal = ((j ?? []) as unknown as { tanggal: string; work_shifts: JadwalSaya["shift"] | JadwalSaya["shift"][] }[])
      .map((x) => ({ tanggal: x.tanggal, shift: Array.isArray(x.work_shifts) ? (x.work_shifts[0] ?? null) : x.work_shifts }));
    koreksi = krError ? [] : ((kr ?? []) as KoreksiSaya[]);
    leaves = l ?? [];
    lembur = (ot ?? []) as Lembur[];
    reimburse = (rb ?? []) as Reimburse[];
    kasbon = ((ca ?? []) as unknown as (Omit<Kasbon, "dibayar"> & { cash_advance_installments: { jumlah: number }[] })[])
      .map((c) => ({
        ...c,
        dibayar: (c.cash_advance_installments ?? []).reduce((a, i) => a + Number(i.jumlah), 0),
      }));
  }
  const tombol = tombolAbsen(absenSaya, wibDate, now.getTime());
  const att = tombol.terbuka ?? tombol.hariIni;
  const shiftHariIni = jadwal.find((x) => x.tanggal === wibDate)?.shift ?? null;
  const shiftKemarinMalam = tombol.terbuka && tombol.terbuka.tanggal !== wibDate;

  return (
    <>
      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success === "in" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-login-2" /> {info || "Absen masuk tercatat."} Selamat bekerja!</div>}
      {success === "out" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-logout-2" /> {info || "Absen pulang tercatat."} Sampai jumpa!</div>}
      {success === "koreksi" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pengajuan koreksi absen terkirim — menunggu persetujuan.</div>}
      {success === "lembur" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pengajuan lembur terkirim — menunggu persetujuan.</div>}
      {success === "kasbon" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pengajuan kasbon terkirim — menunggu persetujuan.</div>}
      {success === "reimburse" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pengajuan reimburse terkirim — menunggu persetujuan.</div>}
      {success === "cuti" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pengajuan terkirim — menunggu persetujuan manajer.</div>}
      {success === "password" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-lock-check" /> Password berhasil diubah.</div>}

      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--posb)", marginBottom: 4 }}>Halo, {emp?.nama?.split(" ")[0] ?? "Staff"}!</div>
      <div style={{ fontSize: 11.5, color: "var(--tm)", marginBottom: 14 }}>{emp?.jabatan ?? "Staff Kasir"} · ringkasan pribadi kamu hari ini.</div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)", letterSpacing: ".04em", marginBottom: 8 }}><i className="ti ti-lock" /> KEAMANAN AKUN</div>
        <PasswordForm action={ubahPasswordPribadi} />
      </div>

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

          {/* 3. Absensi Hari Ini (C1: selfie + lokasi, jam dari server) */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)", letterSpacing: ".04em", marginBottom: 8 }}><i className="ti ti-clock" /> ABSENSI HARI INI</div>
            <div style={{ fontSize: 11.5, marginBottom: 8 }}>
              Shift hari ini:{" "}
              {shiftHariIni ? (
                <b>{shiftHariIni.nama} · {jamRingkas(shiftHariIni.jam_masuk, shiftHariIni.jam_pulang)}</b>
              ) : (
                <span style={{ color: "#92400e" }}>tidak ada jadwal — absen tetap bisa, nanti dicek HR</span>
              )}
            </div>
            {shiftKemarinMalam && (
              <div style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 6 }}>
                Kamu masih tercatat masuk shift tanggal {tombol.terbuka!.tanggal}. Absen pulang dulu.
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11.5 }}>Masuk: <b>{att?.jam_masuk?.slice(0, 5) ?? "—"}</b></div>
              <div style={{ fontSize: 11.5 }}>Pulang: <b>{att?.jam_pulang?.slice(0, 5) ?? "—"}</b></div>
              <div style={{ marginLeft: "auto" }}>
                {tombol.aksi === "masuk" && (
                  <AbsenMandiri aksi={absenMandiri} jenis="masuk" label="Absen Masuk" icon="ti-login-2" />
                )}
                {tombol.aksi === "pulang" && (
                  <AbsenMandiri aksi={absenMandiri} jenis="pulang" label="Absen Pulang" icon="ti-logout-2" warna="var(--am)" />
                )}
                {tombol.aksi === null && <span className="bge g">Selesai hari ini</span>}
              </div>
            </div>
          </div>

          {/* 3b. Jadwal bulan ini */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)", letterSpacing: ".04em", marginBottom: 8 }}><i className="ti ti-calendar-time" /> JADWAL SAYA · {monthKey}</div>
            {jadwal.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--td)" }}>Jadwal bulan ini belum diisi HR.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(92px,1fr))", gap: 6 }}>
                {jadwal.map((x) => (
                  <div key={x.tanggal} style={{
                    border: x.tanggal === wibDate ? "1.5px solid var(--posb)" : ".5px solid var(--bd)",
                    borderRadius: 7, padding: "5px 7px", fontSize: 10.5,
                    background: x.shift?.is_libur ? "#f8fafc" : "#fff",
                  }}>
                    <div style={{ color: "var(--tm)" }}>{namaHari(x.tanggal)} {Number(x.tanggal.slice(8))}</div>
                    <div style={{ fontWeight: 700, color: x.shift?.warna ?? "inherit" }}>{x.shift?.nama ?? "—"}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 9.5 }}>{x.shift ? jamRingkas(x.shift.jam_masuk, x.shift.jam_pulang) : ""}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3c. Koreksi absen */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)", letterSpacing: ".04em", marginBottom: 8 }}><i className="ti ti-clock-edit" /> KOREKSI ABSEN</div>
            <div style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 8 }}>Lupa absen, kamera gagal, atau lokasi tidak terbaca? Ajukan di sini, nanti disetujui atasan.</div>
            <KoreksiAbsenForm hariIni={wibDate} riwayat={koreksi} />
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

type JadwalSaya = {
  tanggal: string;
  shift: { nama: string; jam_masuk: string | null; jam_pulang: string | null; is_libur: boolean; warna: string } | null;
};

const NAMA_HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const namaHari = (tanggal: string) => NAMA_HARI[new Date(`${tanggal}T00:00:00Z`).getUTCDay()];

// Absen kemarin & hari ini (shift malam kemarin bisa masih terbuka). Kolom waktu_masuk baru ada setelah
// migrasi C1 — sebelum itu dibaca tanpa kolom tersebut supaya halaman tetap jalan.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bacaAbsenSaya(supabase: any, employeeId: string, dari: string, sampai: string): Promise<{ data: BarisAbsenSaya[] }> {
  const baru = await supabase.from("attendance").select("tanggal, jam_masuk, jam_pulang, waktu_masuk")
    .eq("employee_id", employeeId).gte("tanggal", dari).lte("tanggal", sampai);
  if (!baru.error) return { data: (baru.data ?? []) as BarisAbsenSaya[] };
  const lama = await supabase.from("attendance").select("tanggal, jam_masuk, jam_pulang")
    .eq("employee_id", employeeId).gte("tanggal", dari).lte("tanggal", sampai);
  return { data: (lama.data ?? []) as BarisAbsenSaya[] };
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
