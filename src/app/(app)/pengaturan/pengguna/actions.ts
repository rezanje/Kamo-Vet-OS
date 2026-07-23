"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const BACK = "/pengaturan/pengguna";

// Buat akun karyawan: signUp via client terpisah (tidak mengganggu sesi admin),
// trigger handle_new_user bikin baris profiles, lalu admin set role/cabang/link karyawan.
// Catatan: bila Supabase "Confirm email" aktif, user baru harus konfirmasi dulu —
// matikan di dashboard Supabase (Authentication → Email) untuk akun internal.
export async function buatPengguna(formData: FormData) {
  const supabase = await createClient(); // sesi admin (RLS is_admin utk update role)

  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "STAFF");
  const employee_id = String(formData.get("employee_id") ?? "").trim() || null;
  const branchIds = formData.getAll("branch_ids").map(String).filter(Boolean);

  const fail = (msg: string) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

  if (!full_name || !email || password.length < 8) fail("Nama, email, dan password (min. 8 karakter) wajib diisi.");
  if (!["OWNER", "ADMIN", "FINANCE", "STAFF", "DOCTOR"].includes(role)) fail("Role tidak dikenal.");

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

  // set role + nama (baris profiles dibuat trigger; update sebagai admin)
  const { error: updErr } = await supabase
    .from("profiles").update({ full_name, role, is_active: true }).eq("id", newId);
  if (updErr) fail(`Akun terbentuk tapi gagal set role: ${updErr.message}`);

  // penugasan cabang
  if (branchIds.length) {
    await supabase.from("user_branches").insert(
      branchIds.map((b, i) => ({ user_id: newId, branch_id: b, role: i === 0 ? "PRIMARY" : "FLOATING" })),
    );
  }

  // link ke data karyawan HRIS (quest/KPI/absensi nyambung)
  if (employee_id) {
    await supabase.from("employees").update({ profile_id: newId }).eq("id", employee_id);
  }

  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent(`Akun ${email} dibuat. Sampaikan password awal ke karyawan ybs.`)}`);
}

// Aktif/nonaktifkan akun. Nonaktif = tidak bisa masuk (dicek di layout).
export async function togglePengguna(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";

  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id === id) redirect(`${BACK}?error=${encodeURIComponent("Tidak bisa menonaktifkan akun sendiri.")}`);

  await supabase.from("profiles").update({ is_active: aktif }).eq("id", id);
  revalidatePath(BACK);
  redirect(BACK);
}
