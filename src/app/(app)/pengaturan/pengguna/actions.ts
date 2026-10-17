"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { assertAccountCreator, assertMasterAdmin } from "@/lib/master-guard";

const BACK = "/pengaturan/pengguna";

// Buat akun karyawan: signUp via client terpisah (tidak mengganggu sesi admin),
// trigger handle_new_user bikin baris profiles, lalu admin set role/cabang/link karyawan.
// Catatan: bila Supabase "Confirm email" aktif, user baru harus konfirmasi dulu —
// matikan di dashboard Supabase (Authentication → Email) untuk akun internal.
export async function buatPengguna(formData: FormData) {
  const supabase = await assertAccountCreator(BACK);

  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "STAFF");
  const employee_id = String(formData.get("employee_id") ?? "").trim() || null;
  const branchIds = formData.getAll("branch_ids").map(String).filter(Boolean);

  const fail = (msg: string) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

  if (!full_name || !email || password.length < 8) fail("Nama, email, dan password (min. 8 karakter) wajib diisi.");
  if (!["OWNER", "ADMIN", "FINANCE", "STAFF", "DOCTOR"].includes(role)) fail("Role tidak dikenal.");

  if (["OWNER", "ADMIN"].includes(role)) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: actor } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
    if (actor?.role !== "OWNER") fail("Hanya Super Admin yang boleh membuat akun Admin atau Super Admin.");
  }

  if (!employee_id) fail("Pilih karyawan HRIS terlebih dahulu.");
  const { data: employee, error: employeeError } = await supabase.from("employees")
    .select("id, profile_id, status").eq("id", employee_id).maybeSingle();
  if (employeeError || !employee || employee.status !== "Aktif" || employee.profile_id) fail("Karyawan tidak tersedia atau sudah memiliki akun. Periksa HRIS.");
  if (["STAFF", "DOCTOR"].includes(role) && !branchIds.length) fail("Pilih penugasan cabang akun.");
  if (branchIds.length) {
    const { data: valid, error } = await supabase.from("branches").select("id").in("id", branchIds).eq("is_active", true);
    if (error || valid?.length !== new Set(branchIds).size) fail("Penugasan cabang tidak valid.");
  }

  // klien terpisah tanpa cookie — sesi admin di browser tidak tertimpa.
  const anon = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: signUpData, error: signUpErr } = await anon.auth.signUp({
    email, password,
    options: { data: { full_name } },
  });
  if (signUpErr) fail(`Gagal membuat akun: ${signUpErr.message}`);
  const newId = signUpData?.user?.id;
  if (!newId) fail("Akun tidak terbentuk (cek pengaturan email Supabase).");

  // Account grants, role and HRIS identity commit together.
  const { error: configureError } = await supabase.rpc("configure_employee_account", {
    p_profile_id: newId, p_employee_id: employee_id, p_full_name: full_name,
    p_role: role, p_branch_ids: [...new Set(branchIds)],
  });
  if (configureError) fail("Akun terbentuk tetapi penautan HRIS belum selesai. Admin perlu meninjau akun sebelum digunakan; jangan membuat ulang akun.");

  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent(`Akun ${email} dibuat. Sampaikan password awal ke karyawan ybs.`)}`);
}

// Aktif/nonaktifkan akun. Nonaktif = tidak bisa masuk (dicek di layout).
export async function togglePengguna(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "akun karyawan");
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";

  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id === id) redirect(`${BACK}?error=${encodeURIComponent("Tidak bisa menonaktifkan akun sendiri.")}`);

  const { error } = await supabase.from("profiles").update({ is_active: aktif }).eq("id", id);
  if (error) redirect(`${BACK}?error=${encodeURIComponent("Status akun gagal disimpan.")}`);
  revalidatePath(BACK);
  redirect(BACK);
}

// Explicit review action; preserves the existing role and branch grants.
export async function tautkanPengguna(form: FormData) {
  const client = await assertMasterAdmin(BACK, "tautan HRIS");
  const profileId = String(form.get("profile_id") ?? "");
  const employeeId = String(form.get("employee_id") ?? "");
  if (!profileId || !employeeId) redirect(`${BACK}?error=${encodeURIComponent("Pilih akun dan karyawan HRIS.")}`);
  const { error } = await client.rpc("link_employee_account", { p_profile_id: profileId, p_employee_id: employeeId });
  if (error) redirect(`${BACK}?error=${encodeURIComponent("Tautan tidak tersedia atau berubah. Muat ulang dan periksa HRIS.")}`);
  revalidatePath(BACK);
  revalidatePath("/hris/karyawan");
  redirect(`${BACK}?success=${encodeURIComponent("Akun sudah tertaut ke karyawan HRIS.")}`);
}
