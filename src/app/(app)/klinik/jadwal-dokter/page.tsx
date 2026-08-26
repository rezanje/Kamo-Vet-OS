import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { hariIniWIB } from "@/lib/tanggal";
import { jamRingkas } from "@/lib/shift-master";
import { isTenagaMedis, rentangTujuhHari, jumlahJaga, type BarisJadwal } from "@/lib/jadwal-dokter";

export default async function JadwalDokterPage({
  searchParams,
}: {
  searchParams: Promise<{ cabang?: string; mulai?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const hariIni = hariIniWIB();
  const mulai = /^\d{4}-\d{2}-\d{2}$/.test(sp.mulai ?? "") ? sp.mulai! : hariIni;
  const hari = rentangTujuhHari(mulai);

  const [{ data: branchData }, { data: allEmp }, { data: shiftData }] = await Promise.all([
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase.from("employees").select("id, nama, jabatan, branch_id").eq("status", "Aktif").order("nama"),
    supabase.from("work_shifts").select("id, nama, is_libur, jam_masuk, jam_pulang").eq("is_active", true),
  ]);
  const branches = (branchData ?? []) as { id: string; name: string }[];

  type Emp = { id: string; nama: string; jabatan: string | null; branch_id: string | null };
  const semuaMedis = ((allEmp ?? []) as Emp[]).filter(isTenagaMedis);

  // Bawaannya cabang yang MEMANG punya tenaga medis — cabang pertama menurut abjad
  // biasanya gudang/kantor, dan layar jadwal dokter yang selalu kosong bikin orang
  // mengira fiturnya rusak.
  const cabang = branches.some((b) => b.id === sp.cabang)
    ? sp.cabang!
    : branches.find((b) => semuaMedis.some((e) => e.branch_id === b.id))?.id ?? branches[0]?.id ?? "";

  const medis = semuaMedis.filter((e) => e.branch_id === cabang);
  const shiftById = new Map(
    ((shiftData ?? []) as { id: string; nama: string; is_libur: boolean; jam_masuk: string | null; jam_pulang: string | null }[])
      .map((s) => [s.id, { nama: s.nama, jam: jamRingkas(s.jam_masuk, s.jam_pulang), libur: s.is_libur }]),
  );

  const { data: jadwalData } = medis.length
    ? await supabase.from("employee_schedules").select("employee_id, tanggal, shift_id")
        .in("employee_id", medis.map((m) => m.id))
        .gte("tanggal", hari[0].tanggal).lte("tanggal", hari[6].tanggal)
    : { data: [] as { employee_id: string; tanggal: string; shift_id: string }[] };

  const baris: BarisJadwal[] = medis.map((m) => ({
    employeeId: m.id, nama: m.nama, jabatan: m.jabatan, perHari: {},
  }));
  const barisById = new Map(baris.map((b) => [b.employeeId, b]));
  for (const j of (jadwalData ?? []) as { employee_id: string; tanggal: string; shift_id: string }[]) {
    const b = barisById.get(j.employee_id);
    if (b) b.perHari[j.tanggal] = shiftById.get(j.shift_id) ?? null;
  }

  const namaCabang = branches.find((b) => b.id === cabang)?.name ?? "—";
  const jagaHariIni = jumlahJaga(baris, hariIni);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Jadwal Dokter</span>
      </div>

      <div className="crm-sec">
        <SecHeader
          num="01" title="SIAPA YANG JAGA"
          desc={`${namaCabang} · ${medis.length} tenaga medis · hari ini ${jagaHariIni} orang masuk. Jadwalnya diatur di HRIS — di sini hanya dilihat.`}
          action={
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select className="fi" name="cabang" defaultValue={cabang} style={{ fontSize: 11, height: 30, width: 180 }}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <input className="fi" type="date" name="mulai" defaultValue={mulai} style={{ fontSize: 11, height: 30, width: 140 }} />
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>Tampilkan</button>
            </form>
          }
        />

        {medis.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--td)" }}>
            Belum ada dokter/paramedis aktif di cabang ini. Tambahkan dulu di{" "}
            <Link href="/hris/karyawan" style={{ color: "var(--posb)" }}>Karyawan</Link>.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 170 }}>Tenaga medis</th>
                  {hari.map((h) => (
                    <th key={h.tanggal} style={{ textAlign: "center", background: h.tanggal === hariIni ? "#eff6ff" : undefined }}>
                      {h.namaHari} {h.hari}
                      {h.tanggal === hariIni && <div style={{ fontSize: 9, color: "var(--posb)" }}>hari ini</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {baris.map((b) => (
                  <tr key={b.employeeId}>
                    <td>
                      <div style={{ fontSize: 11.5, fontWeight: 600 }}>{b.nama}</div>
                      <div style={{ fontSize: 10, color: "var(--td)" }}>{b.jabatan ?? "—"}</div>
                    </td>
                    {hari.map((h) => {
                      const s = b.perHari[h.tanggal];
                      const masuk = !!s && !s.libur;
                      return (
                        <td key={h.tanggal} style={{ textAlign: "center", background: h.tanggal === hariIni ? "#f8fbff" : undefined }}>
                          {s ? (
                            <>
                              <div style={{ fontSize: 10.5, fontWeight: masuk ? 600 : 400, color: masuk ? "#15803d" : "var(--td)" }}>
                                {s.nama}
                              </div>
                              <div style={{ fontSize: 9.5, color: "var(--td)" }}>{s.jam}</div>
                            </>
                          ) : (
                            <span style={{ fontSize: 10.5, color: "var(--td)" }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 10.5, color: "var(--td)" }}>
          Mau ubah jadwalnya?{" "}
          <Link href={`/hris/jadwal?cabang=${cabang}`} style={{ color: "var(--posb)" }}>Atur di HRIS → Jadwal Shift</Link>.
          Kolom kosong berarti orang itu belum dijadwalkan hari tersebut.
        </div>
      </div>
    </>
  );
}
