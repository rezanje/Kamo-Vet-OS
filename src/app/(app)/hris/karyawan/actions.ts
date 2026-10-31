"use server";

import { revalidatePath } from "next/cache";
import { parseEmployeeBranches } from "@/lib/employee-branch-input";
import { bacaAkhiriPenugasan, bacaCabangUtamaMassal } from "@/lib/employee-assignment";
import { hariIniWIB } from "@/lib/tanggal";
import { bacaEditKaryawan } from "@/lib/karyawan-edit";
import { redirect } from "next/navigation";
import { assertHrisManager, assertMasterAdmin, bolehKelolaPayroll, klienMasterAdmin } from "@/lib/master-guard";
import { simpanGajiPokok } from "@/lib/employee-salary";
import { employeeOccupationInput } from "@/lib/employee-occupation";

/** Hasil aksi yang ditampilkan di layar tanpa pindah halaman (useActionState). */
export type HasilAksi = { ok: boolean; pesan: string } | null;

// RPC HRIS memakai awalan tetap untuk pesan yang memang ditujukan ke pengguna.
// Pesan lain (galat database) tidak pernah ditampilkan apa adanya.
const PESAN_RPC = /^(ACCESS_DENIED|ASSIGNMENT_INVALID|BRANCH_INVALID): /;
function pesanRpc(error: { message?: string } | null, bawaan: string) {
  const pesan = String(error?.message ?? "");
  return PESAN_RPC.test(pesan) ? pesan.replace(PESAN_RPC, "") : bawaan;
}

const TANPA_HAK = "Kamu tidak punya hak untuk mengubah penugasan cabang";

export async function simpanKaryawan(formData: FormData) {
  const supabase = await assertHrisManager("/hris/karyawan");

  const nama = String(formData.get("nama") ?? "").trim();
  const nik = String(formData.get("nik") ?? "").trim() || null;
  let jabatan: string | null;
  try { jabatan = employeeOccupationInput(formData); }
  catch (error) { redirect(`/hris/karyawan?error=${encodeURIComponent(error instanceof Error ? error.message : "Jabatan tidak valid")}`); }
  const departemen = String(formData.get("departemen") ?? "").trim() || null;
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const tglMasuk = String(formData.get("tgl_masuk") ?? "").trim() || null;
  const gajiPokok = Number(formData.get("gaji_pokok")) || 0;
  const status = String(formData.get("status") ?? "Aktif");

  if (!["Aktif", "Nonaktif"].includes(status)) redirect("/hris/karyawan?error=Status%20karyawan%20tidak%20valid");

  // ponytail: validasi nama wajib diisi sebelum insert.
  if (!nama) {
    redirect(`/hris/karyawan?error=${encodeURIComponent("Nama karyawan wajib diisi")}`);
  }
  if (status === "Aktif" && !branchId) {
    redirect(`/hris/karyawan?error=${encodeURIComponent("Pilih cabang utama sebelum mengaktifkan karyawan")}`);
  }

  const { data: created, error } = await supabase.from("employees").insert({
    nik,
    nama,
    jabatan,
    departemen,
    branch_id: branchId,
    phone,
    email,
    tgl_masuk: tglMasuk,
    status,
  }).select("id").single();

  if (error) {
    const msg =
      error.code === "23505"
        ? "NIK sudah terdaftar, gunakan NIK lain"
        : "Gagal menyimpan data karyawan";
    redirect(`/hris/karyawan?error=${encodeURIComponent(msg)}`);
  }

  if (gajiPokok > 0 && created?.id && (await bolehKelolaPayroll())) {
    if (!(await simpanGajiPokok(supabase, created.id, gajiPokok))) {
      redirect(`/hris/karyawan?error=${encodeURIComponent("Karyawan tersimpan, tetapi gaji pokok belum tersimpan")}`);
    }
  }

  if (branchId && created?.id) {
    const { error: assignmentError } = await supabase.from("employee_branch_assignments").upsert({
      employee_id: created.id,
      branch_id: branchId,
      role: "PRIMARY",
      effective_date: tglMasuk || new Date().toISOString().slice(0, 10),
    }, { onConflict: "employee_id,branch_id" });
    if (assignmentError) {
      redirect(`/hris/karyawan?error=${encodeURIComponent("Karyawan tersimpan, tetapi penugasan cabang belum tersimpan")}`);
    }
  }

  redirect("/hris/karyawan?success=1");
}

/**
 * Penugasan lintas cabang. Dulu aksi ini redirect ke /hris/karyawan, sehingga
 * setiap simpan memaksa seluruh daftar karyawan (plus penugasan dan gaji pokok)
 * dirender ulang di server — itulah "loading lama" yang dilaporkan Andri.
 * Sekarang hasilnya dikembalikan sebagai pesan di halaman kecil ini saja.
 */
export async function simpanPenugasanCabang(_prev: HasilAksi, formData: FormData): Promise<HasilAksi> {
  const supabase = await klienMasterAdmin();
  if (!supabase) return { ok: false, pesan: TANPA_HAK };
  let input;
  try { input = parseEmployeeBranches(formData, hariIniWIB()); }
  catch (error) { return { ok: false, pesan: error instanceof Error ? error.message : "Penugasan tidak valid" }; }
  const { error } = await supabase.rpc("assign_employee_secondary_branches", {
    p_employee_id: input.employeeId,
    p_branch_ids: input.branchIds,
    p_effective_date: input.effectiveDate,
  });
  if (error) {
    return { ok: false, pesan: pesanRpc(error, "Penugasan belum tersimpan. Pastikan karyawan dan seluruh cabang aktif, dapat diakses, dan berbeda dari cabang utama.") };
  }
  revalidatePath("/hris/karyawan/penugasan");
  revalidatePath("/hris/karyawan");
  revalidatePath(`/hris/karyawan/${input.employeeId}`);
  return { ok: true, pesan: `Penugasan tersimpan untuk ${input.branchIds.length} cabang, mulai ${input.effectiveDate}.` };
}

/** T2: tutup satu penugasan lintas cabang dengan tanggal berakhir dan alasan. */
export async function akhiriPenugasanCabang(_prev: HasilAksi, formData: FormData): Promise<HasilAksi> {
  const supabase = await klienMasterAdmin();
  if (!supabase) return { ok: false, pesan: TANPA_HAK };
  let input;
  try { input = bacaAkhiriPenugasan(formData, hariIniWIB()); }
  catch (error) { return { ok: false, pesan: error instanceof Error ? error.message : "Penugasan tidak valid" }; }
  const { error } = await supabase.rpc("end_employee_branch_assignment", {
    p_employee_id: input.employeeId,
    p_branch_id: input.branchId,
    p_end_date: input.endDate,
    p_reason: input.reason,
  });
  if (error) return { ok: false, pesan: pesanRpc(error, "Penugasan belum dapat diakhiri. Muat ulang halaman lalu coba lagi.") };
  revalidatePath("/hris/karyawan/penugasan");
  revalidatePath("/hris/karyawan");
  revalidatePath(`/hris/karyawan/${input.employeeId}`);
  return { ok: true, pesan: `Penugasan diakhiri per ${input.endDate}.` };
}

/** T1: pembersihan terpandu — HR memilih sendiri orang dan cabangnya, tanpa tebakan. */
export async function setCabangUtamaMassal(_prev: HasilAksi, formData: FormData): Promise<HasilAksi> {
  const supabase = await klienMasterAdmin();
  if (!supabase) return { ok: false, pesan: "Kamu tidak punya hak untuk mengubah cabang utama karyawan" };
  let input;
  try { input = bacaCabangUtamaMassal(formData); }
  catch (error) { return { ok: false, pesan: error instanceof Error ? error.message : "Pilihan tidak valid" }; }
  const { data, error } = await supabase.rpc("set_employee_primary_branches", {
    p_employee_ids: input.employeeIds,
    p_branch_id: input.branchId,
    p_reason: input.reason,
  });
  if (error) return { ok: false, pesan: pesanRpc(error, "Cabang utama belum tersimpan. Muat ulang halaman lalu coba lagi.") };
  revalidatePath("/hris/karyawan/tanpa-cabang");
  revalidatePath("/hris/karyawan");
  revalidatePath("/hris/karyawan/penugasan");
  return { ok: true, pesan: `${Number(data ?? 0)} karyawan mendapat cabang utama baru.` };
}

export async function editKaryawan(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/hris/karyawan?error=Karyawan%20tidak%20valid");
  const back = `/hris/karyawan/${id}`;
  const supabase = await assertMasterAdmin(back, "data karyawan");
  let row;
  try { row = bacaEditKaryawan(formData); }
  catch (error) { redirect(`${back}?edit=1&error=${encodeURIComponent(error instanceof Error ? error.message : "Data tidak valid")}`); }
  const { status: _status, gaji_pokok, branch_id, alasan_cabang, ...fields } = row;
  void _status; // Status uses the separate audited lifecycle action.
  const { data, error } = await supabase.from("employees").update(fields).eq("id", id).select("id").maybeSingle();
  if (error || !data) redirect(`${back}?edit=1&error=${encodeURIComponent(error?.code === "23505" ? "NIK sudah terdaftar" : "Data karyawan gagal diperbarui")}`);
  // Cabang utama lewat RPC: baris penugasan ikut dirapikan dan perubahannya tercatat.
  // RPC tidak melakukan apa pun bila cabangnya memang sudah sama.
  if (branch_id) {
    const { error: branchError } = await supabase.rpc("set_employee_primary_branches", {
      p_employee_ids: [id],
      p_branch_id: branch_id,
      p_reason: alasan_cabang,
    });
    if (branchError) redirect(`${back}?edit=1&error=${encodeURIComponent(pesanRpc(branchError, "Data tersimpan, tetapi cabang utama belum berpindah"))}`);
  }
  // Gaji pokok hanya diubah OWNER; field-nya memang tidak tampil untuk peran lain.
  if (gaji_pokok !== null && (await bolehKelolaPayroll()) && !(await simpanGajiPokok(supabase, id, gaji_pokok))) {
    redirect(`${back}?edit=1&error=${encodeURIComponent("Data tersimpan, tetapi gaji pokok belum tersimpan")}`);
  }
  revalidatePath("/hris/karyawan");
  revalidatePath(back);
  revalidatePath("/hris/penggajian");
  redirect(`${back}?success=1`);
}
