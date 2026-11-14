import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { hariIniWIB } from "@/lib/tanggal";
import { jamRingkas } from "@/lib/shift-master";
import { bacaPapanJadwal } from "@/lib/jadwal-karyawan";
import { bulanSebelumnya } from "@/lib/jadwal-salin";
import { JadwalBoard, type ShiftOpsi } from "./JadwalBoard";
import { SalinJadwalForm } from "./SalinJadwalForm";

const NAMA_HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

// Semua tanggal dalam satu bulan, dibuat manual supaya tidak kena geser zona waktu.
function hariDalamBulan(bulan: string) {
  const [thn, bln] = bulan.split("-").map(Number);
  const jumlah = new Date(thn, bln, 0).getDate();
  return Array.from({ length: jumlah }, (_, i) => {
    const hari = i + 1;
    const tanggal = `${bulan}-${String(hari).padStart(2, "0")}`;
    const dow = new Date(thn, bln - 1, hari).getDay();
    return { tanggal, hari, namaHari: NAMA_HARI[dow], akhirPekan: dow === 0 };
  });
}

export default async function JadwalPage({
  searchParams,
}: {
  searchParams: Promise<{ cabang?: string; bulan?: string; error?: string; success?: string; info?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const hariIni = hariIniWIB();
  const bulan = /^\d{4}-\d{2}$/.test(sp.bulan ?? "") ? sp.bulan! : hariIni.slice(0, 7);
  const { data: branchData } = await supabase
    .from("branches").select("id, name").eq("is_active", true).order("name");
  const branches = (branchData ?? []) as { id: string; name: string }[];
  const cabang = branches.some((b) => b.id === sp.cabang) ? sp.cabang! : branches[0]?.id ?? "";

  const hari = hariDalamBulan(bulan);
  const awalBulan = hari[0]?.tanggal ?? `${bulan}-01`;
  const akhirBulan = hari[hari.length - 1]?.tanggal ?? `${bulan}-28`;

  const papan = await bacaPapanJadwal(supabase, cabang, hariIni);
  const karyawan = papan.karyawan;
  const shifts: ShiftOpsi[] = papan.shifts.map((s) => ({
    id: s.id, nama: s.nama, warna: s.warna, is_libur: s.is_libur,
    jam: jamRingkas(s.jam_masuk, s.jam_pulang),
  }));

  const { data: jadwalData } = karyawan.length
    ? await supabase.from("employee_schedules").select("employee_id, tanggal, shift_id")
        .in("employee_id", karyawan.map((k) => k.id))
        .gte("tanggal", awalBulan).lte("tanggal", akhirBulan)
    : { data: [] };

  const awal: Record<string, string> = {};
  for (const j of (jadwalData ?? []) as { employee_id: string; tanggal: string; shift_id: string }[]) {
    awal[`${j.employee_id}|${j.tanggal}`] = j.shift_id;
  }

  const terisi = Object.keys(awal).length;
  const namaBulan = new Date(`${bulan}-01T00:00:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", month: "long", year: "numeric" });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/hris" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Jadwal Shift</span>
      </div>

      {sp.error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {sp.error}
        </div>
      )}
      {sp.success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {sp.info || "Jadwal tersimpan."}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader
          num="01" title={`JADWAL ${namaBulan.toUpperCase()}`}
          desc={`${karyawan.length} karyawan · ${terisi} hari sudah terjadwal · telat dihitung dari jam shift orang itu`}
          action={
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select className="fi" name="cabang" defaultValue={cabang} style={{ fontSize: 11, height: 30, width: 180 }}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <input className="fi" type="month" name="bulan" defaultValue={bulan} style={{ fontSize: 11, height: 30, width: 130 }} />
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>Tampilkan</button>
            </form>
          }
        />

        {shifts.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--td)" }}>
            Belum ada shift aktif untuk cabang ini. Buat dulu di{" "}
            <Link href="/hris/shift" style={{ color: "#2563eb" }}>Master Shift</Link>.
          </div>
        ) : (
          <>
            {bolehKelola && karyawan.length > 0 && (
              <SalinJadwalForm cabang={cabang} bulan={bulan} bulanLalu={bulanSebelumnya(bulan)} adaIsi={terisi > 0} />
            )}
            <JadwalBoard
              karyawan={karyawan} shifts={shifts} hari={hari} awal={awal}
              cabang={cabang} bulan={bulan} bolehKelola={bolehKelola}
            />
          </>
        )}
      </div>
    </>
  );
}
