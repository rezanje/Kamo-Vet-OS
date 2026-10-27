"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const PATH = "/perusahaan/cabang";

// Admin gate mirrors the RLS user_branches_admin_write policy (OWNER/ADMIN).
// RLS is the real enforcement; this just yields a friendly message instead of a
// silent no-op when a non-admin submits.
async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`${PATH}?error=${encodeURIComponent("Hanya owner/admin yang bisa mengatur pengguna cabang")}`);
  }
  return supabase;
}

export async function assignUser(formData: FormData) {
  const supabase = await requireAdmin();
  const user_id = String(formData.get("user_id") ?? "");
  const branch_id = String(formData.get("branch_id") ?? "");
  const role = formData.get("role") === "SECONDARY" ? "SECONDARY" : "PRIMARY";
  if (!user_id || !branch_id) {
    redirect(`${PATH}?error=${encodeURIComponent("Pilih pengguna dulu")}`);
  }

  const { error } = await supabase
    .from("user_branches")
    .upsert({ user_id, branch_id, role }, { onConflict: "user_id,branch_id" });
  if (error) redirect(`${PATH}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(PATH);
  redirect(`${PATH}?success=1`);
}

export async function unassignUser(formData: FormData) {
  const supabase = await requireAdmin();
  const user_id = String(formData.get("user_id") ?? "");
  const branch_id = String(formData.get("branch_id") ?? "");

  const { error } = await supabase
    .from("user_branches").delete().eq("user_id", user_id).eq("branch_id", branch_id);
  if (error) redirect(`${PATH}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(PATH);
  redirect(`${PATH}?success=1`);
}

const BRANCH_TYPES = ["PETSHOP", "KLINIK", "BOTH", "DC", "ONLINE", "OFFICE"];
// SQLSTATE dari pengaman RPC create_branch sendiri; galat lain tetap pesan umum.
const BRANCH_GUARD_CODES = new Set(["42501", "22023"]);

/** U11: cabang baru hanya oleh OWNER aktif. Pengaman sebenarnya ada di RPC create_branch. */
export async function tambahCabang(formData: FormData) {
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const status = String(formData.get("is_active") ?? "");
  if (!code || !name || !BRANCH_TYPES.includes(type) || !["1", "0"].includes(status)) {
    redirect(`${PATH}?error=${encodeURIComponent("Lengkapi kode, nama, jenis, dan status cabang")}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_branch", {
    p_code: code, p_name: name, p_type: type, p_is_active: status === "1",
  });
  if (error) {
    const message = error.code === "23505"
      ? "Kode cabang sudah dipakai. Gunakan kode lain."
      : BRANCH_GUARD_CODES.has(error.code ?? "") && error.message
        ? error.message
        : "Cabang belum dapat disimpan. Coba lagi.";
    redirect(`${PATH}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(PATH);
  revalidatePath("/perusahaan/gudang");
  revalidatePath("/pengaturan/cabang");
  redirect(`${PATH}?success=${encodeURIComponent(`Cabang ${name} sudah dibuat`)}`);
}
