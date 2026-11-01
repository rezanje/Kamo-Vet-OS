"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { assertAccountCreator, assertMasterAdmin } from "@/lib/master-guard";
import { isAccountEditId } from "@/lib/user-account-edit";

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

// Editing an existing login must never enter the signup/HRIS configuration flow.
export async function simpanEditPengguna(form: FormData): Promise<{ ok: false; message: string }> {
  const client = await assertMasterAdmin(BACK, "akun karyawan");
  const profileId = String(form.get("profile_id") ?? "");
  const fullName = String(form.get("full_name") ?? "").trim();
  const role = String(form.get("role") ?? "");
  const branchIds = form.getAll("branch_ids").map(String);
  const version = String(form.get("expected_version") ?? "");
  const requestId = String(form.get("request_id") ?? "");
  if (!isAccountEditId(profileId) || !isAccountEditId(requestId) || branchIds.some((id) => !isAccountEditId(id))) {
    return { ok: false, message: "Pilihan akun atau cabang tidak valid. Muat ulang halaman edit." };
  }
  if (!fullName || fullName.length > 200 || !["OWNER", "ADMIN", "FINANCE", "DOCTOR", "STAFF"].includes(role) || !version || version.length > 200) {
    return { ok: false, message: "Isi nama akun (maks. 200 karakter), role, dan versi akun yang valid." };
  }
  try {
    const { data, error } = await client.rpc("edit_user_account", {
      p_profile_id: profileId, p_full_name: fullName, p_role: role,
      p_branch_ids: [...new Set(branchIds)], p_expected_version: version, p_request_id: requestId,
    });
    if (error) {
      return { ok: false, message: error.code === "40001" || String(error.message).startsWith("ACCOUNT_EDIT_CONFLICT:")
        ? "Akun sudah berubah sejak halaman dibuka. Isian tetap tersimpan di halaman ini; muat ulang untuk meninjau data terbaru sebelum mengulang."
        : "Perubahan akun ditolak. Periksa hak akses, role, dan penugasan cabang; isian tetap ada." };
    }
    if (!data || data.profile_id !== profileId || typeof data.version !== "string") {
      return { ok: false, message: "Hasil simpan belum dapat dipastikan. Coba simpan lagi dengan isian yang sama." };
    }
  } catch {
    return { ok: false, message: "Hasil simpan belum dapat dipastikan. Coba simpan lagi dengan isian yang sama." };
  }
  revalidatePath(BACK);
  revalidatePath(`${BACK}/${profileId}/edit`);
  redirect(`${BACK}?success=${encodeURIComponent("Perubahan akun berhasil disimpan.")}`);
}

export type ResetLoginResult = { ok: boolean; message: string };

const PESAN_RESET: Record<string, string> = {
  LOGIN_RESET_DENIED: "Hanya Super Admin yang boleh mengganti email atau password akun.",
  LOGIN_RESET_NOT_FOUND: "Akun tidak ditemukan. Muat ulang halaman.",
  LOGIN_RESET_EMAIL_INVALID: "Format email tidak valid.",
  LOGIN_RESET_EMAIL_TAKEN: "Email ini sudah dipakai akun lain.",
  LOGIN_RESET_PASSWORD_INVALID: "Password baru harus 8–72 karakter.",
  LOGIN_RESET_NOTHING: "Tidak ada perubahan: isi email baru atau password baru.",
};

// U13: Super Admin mengganti email login dan/atau mengatur ulang password karyawan.
// Pemeriksaan hak & perubahan terjadi di satu fungsi database; di sini hanya validasi awal.
export async function resetLoginPengguna(form: FormData): Promise<ResetLoginResult> {
  const client = await assertMasterAdmin(BACK, "login akun karyawan");
  const profileId = String(form.get("profile_id") ?? "");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const konfirmasi = String(form.get("password_konfirmasi") ?? "");
  if (!isAccountEditId(profileId)) return { ok: false, message: "Akun tidak valid. Muat ulang halaman." };
  if (password && (password.length < 8 || password.length > 72)) return { ok: false, message: PESAN_RESET.LOGIN_RESET_PASSWORD_INVALID };
  if (password !== konfirmasi) return { ok: false, message: "Konfirmasi password tidak sama." };
  if (!email && !password) return { ok: false, message: PESAN_RESET.LOGIN_RESET_NOTHING };
  try {
    const { data, error } = await client.rpc("owner_reset_akun_login", {
      p_profile_id: profileId, p_email: email || null, p_password: password || null,
    });
    if (error) {
      const kode = Object.keys(PESAN_RESET).find((k) => String(error.message).startsWith(`${k}:`));
      return { ok: false, message: kode ? PESAN_RESET[kode] : "Reset login gagal disimpan. Coba lagi." };
    }
    const hasil = data as { email_changed?: boolean; password_changed?: boolean } | null;
    revalidatePath(`${BACK}/${profileId}/edit`);
    const bagian = [hasil?.email_changed && `email login diganti ke ${email}`, hasil?.password_changed && "password baru aktif"].filter(Boolean);
    return { ok: true, message: `Berhasil: ${bagian.join(" dan ")}. Karyawan perlu masuk ulang dengan data baru.` };
  } catch {
    return { ok: false, message: "Hasil reset belum dapat dipastikan. Muat ulang halaman sebelum mengulang." };
  }
}
