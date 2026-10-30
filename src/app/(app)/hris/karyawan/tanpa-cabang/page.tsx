import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { branchDisplayName } from "@/lib/branch-display";
import { labelPeranKlinis } from "@/lib/karyawan-filter";
import { hariIniWIB } from "@/lib/tanggal";
import { labelPenugasan } from "@/lib/employee-assignment";
import { PembersihanCabangForm, type BarisTanpaCabang } from "../PembersihanCabangForm";

type Karyawan = { id: string; nama: string; nik: string | null; jabatan: string | null };
type Penugasan = { employee_id: string; branch_id: string; role: "PRIMARY" | "SECONDARY"; effective_date: string; end_date: string | null };

/**
 * Audit HRIS T1: dari seluruh karyawan aktif, sebagian besar tidak punya cabang
 * utama, sehingga tidak pernah muncul sebagai pilihan dokter/petugas/groomer di
 * klinik maupun kasir. Layar ini mendaftar mereka dan membiarkan HR memilih
 * cabangnya satu per satu atau sekaligus — tanpa tebakan otomatis.
 */
export default async function KaryawanTanpaCabangPage() {
  if (!await bolehKelolaMaster()) redirect("/hris/karyawan");
  const supabase = await createClient();
  const hariIni = hariIniWIB();

  const [{ data: branchData }, { data: employeeData, error: employeeError }] = await Promise.all([
    supabase.from("branches").select("id, code, name, type").eq("is_active", true).order("name"),
    supabase.from("employees").select("id, nama, nik, jabatan")
      .eq("status", "Aktif").is("trashed_at", null).is("branch_id", null).order("nama"),
  ]);
  if (employeeError) throw new Error("Daftar karyawan tanpa cabang gagal dimuat");

  const branchCatalog = branchData ?? [];
  const branches = branchCatalog.map(branch => ({ id: branch.id, name: branchDisplayName(branch, branchCatalog) }));
  const namaCabang = new Map(branches.map(branch => [branch.id, branch.name]));
  const karyawan = (employeeData ?? []) as Karyawan[];

  // Penugasan hanya dibaca untuk orang-orang yang tampil di layar ini.
  const penugasan: Penugasan[] = [];
  for (let offset = 0; offset < karyawan.length; offset += 200) {
    const { data } = await supabase.from("employee_branch_assignments")
      .select("employee_id, branch_id, role, effective_date, end_date")
      .in("employee_id", karyawan.slice(offset, offset + 200).map(row => row.id));
    penugasan.push(...((data ?? []) as Penugasan[]));
  }
  const perKaryawan = new Map<string, Penugasan[]>();
  for (const row of penugasan) perKaryawan.set(row.employee_id, [...(perKaryawan.get(row.employee_id) ?? []), row]);

  const rows: BarisTanpaCabang[] = karyawan.map(row => {
    const tugas = perKaryawan.get(row.id) ?? [];
    return {
      id: row.id,
      nama: row.nama,
      nik: row.nik,
      jabatan: row.jabatan,
      peran: labelPeranKlinis(row.jabatan),
      penugasan: tugas.length
        ? tugas.map(item => {
            const keterangan = labelPenugasan(item, hariIni);
            return `${namaCabang.get(item.branch_id) ?? "Cabang tidak ditemukan"}${keterangan ? ` (${keterangan})` : ""}`;
          }).join(", ")
        : "Belum ada",
    };
  });
  const tanpaPenugasan = rows.filter(row => row.penugasan === "Belum ada").length;

  return <>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
      <Link href="/hris/karyawan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke Karyawan</Link>
      <span style={{ color: "var(--td)" }}>·</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>Karyawan tanpa cabang</span>
    </div>

    <div className="crm-sec">
      <SecHeader num="01" title="SET CABANG UTAMA" desc="Karyawan aktif yang belum punya cabang utama. Pilih orangnya, pilih cabangnya, lalu simpan sekaligus." />
      <p style={{ fontSize: 11, color: "var(--tm)" }}>
        {rows.length} karyawan aktif belum punya cabang utama{tanpaPenugasan ? `, ${tanpaPenugasan} di antaranya juga belum punya penugasan cabang mana pun` : ""}.
        Selama cabangnya kosong, mereka tidak bisa dipilih sebagai dokter, petugas, atau groomer di layar klinik dan kasir.
        Cabang tidak ditebak dari jabatan — pilihan ada di tangan HR, dan setiap perubahan tercatat beserta pelakunya.
      </p>
      <PembersihanCabangForm rows={rows} branches={branches} />
    </div>
  </>;
}
