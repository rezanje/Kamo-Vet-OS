import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { hariIniWIB } from "@/lib/tanggal";
import { hariPeriode, tanggalValid, geserTanggal } from "@/lib/jadwal-kalender";
import { aksesCabangHRIS, scopeJadwal } from "@/lib/jadwal-scope";
import { JadwalExcel } from "./JadwalExcel";
import { jamRingkas } from "@/lib/shift-master";
import { JadwalBoard, type KaryawanBaris, type ShiftOpsi } from "./JadwalBoard";

export default async function JadwalPage({
  searchParams,
}: {
  searchParams: Promise<{ cabang?: string; bulan?: string; error?: string; success?: string; minggu?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const bulan = tanggalValid(`${sp.bulan}-01`) ? sp.bulan! : hariIniWIB().slice(0, 7);
  const minggu = tanggalValid(sp.minggu) ? sp.minggu : undefined;
  const access = await aksesCabangHRIS(supabase);
  const branches = access.branches;
  const cabang = branches.some(b => b.id === sp.cabang) ? sp.cabang! : branches[0]?.id ?? "";
  const hari = hariPeriode(bulan, minggu);
  const scope = cabang ? await scopeJadwal(supabase,cabang,hari[0].tanggal,hari.at(-1)!.tanggal) : null;
  const karyawan: KaryawanBaris[] = scope?.karyawan ?? [];
  const shifts: ShiftOpsi[] = (scope?.shifts ?? []).map(s => ({id:s.id,nama:s.nama,warna:s.warna,is_libur:s.is_libur,is_active:s.is_active,jam:jamRingkas(s.jam_masuk,s.jam_pulang)}));
  const awal = scope?.existing ?? {};
  const linkPeriode = (date?: string) => `/hris/jadwal?${new URLSearchParams({cabang,bulan,...(date?{minggu:date}:{})})}`;
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
          <i className="ti ti-circle-check" /> Jadwal tersimpan ({sp.success} sel).
        </div>
      )}

      <div className="crm-sec">
        <SecHeader
          num="01" title={minggu ? `JADWAL ${hari[0].tanggal} — ${hari.at(-1)!.tanggal}` : `JADWAL ${namaBulan.toUpperCase()}`}
          desc={`${karyawan.length} karyawan · ${terisi} hari sudah terjadwal · telat dihitung dari jam shift orang itu`}
          action={
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select aria-label="Cabang" className="fi" name="cabang" defaultValue={cabang} style={{ fontSize: 11, height: 30, width: 180 }}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <input aria-label="Bulan" className="fi" type="month" name="bulan" defaultValue={bulan} style={{ fontSize: 11, height: 30, width: 130 }} />
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>Tampilkan</button>
            </form>
          }
        />

        <nav aria-label="Periode jadwal" style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
          <Link className="btn-def" href={linkPeriode()}>Bulan</Link>
          <Link className="btn-def" href={linkPeriode(minggu ?? (bulan === hariIniWIB().slice(0,7) ? hariIniWIB() : `${bulan}-01`))}>Minggu</Link>
          {minggu && <><Link className="btn-def" href={linkPeriode(geserTanggal(hari[0].tanggal,-7))}>← Minggu sebelumnya</Link><Link className="btn-def" href={linkPeriode(geserTanggal(hari[0].tanggal,7))}>Minggu berikutnya →</Link></>}
        </nav>
        {!cabang && <p role="alert">Belum ada cabang yang diizinkan untuk akun ini.</p>}
        {shifts.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--td)" }}>
            Belum ada shift aktif untuk cabang ini. Buat dulu di{" "}
            <Link href="/hris/shift" style={{ color: "#2563eb" }}>Master Shift</Link>.
          </div>
        ) : (
          <JadwalBoard key={`${cabang}|${hari[0].tanggal}|${hari.length}|${JSON.stringify(awal)}`}
            karyawan={karyawan} shifts={shifts} hari={hari} awal={awal}
            cabang={cabang} bulan={bulan} minggu={minggu} employeeStarts={scope?.employeeStarts ?? {}} bolehKelola={bolehKelola}
          />
        )}
        {scope && <JadwalExcel key={`${cabang}|${hari[0].tanggal}|${hari.length}|${JSON.stringify(awal)}`} karyawan={karyawan} shifts={shifts} awal={awal} cabang={cabang} bulan={bulan} minggu={minggu} awalTanggal={hari[0].tanggal} akhirTanggal={hari.at(-1)!.tanggal} employeeStarts={scope?.employeeStarts ?? {}} bolehKelola={bolehKelola} />}
      </div>
    </>
  );
}
