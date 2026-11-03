"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { roleRpcFailure } from "@/lib/role-action-access";

const PATH = "/perusahaan/cabang";
// Never show the raw database message: known role/people codes map to Indonesian, the rest is generic.
const pesanPenugasan = (error: unknown) => roleRpcFailure(error)?.message ?? "Penugasan cabang gagal disimpan. Tidak ada perubahan yang dipastikan tersimpan; muat ulang halaman lalu coba lagi.";

// Friendly early manager gate only. The bounded RPC is authoritative, retains
// the original account target/branch ceilings and writes the account audit.
// Direct authenticated user_branches writes are deliberately rejected.
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

  const { error } = await supabase.rpc("set_user_branch_assignment", {
    p_profile_id: user_id, p_branch_id: branch_id, p_assignment_role: role, p_remove: false,
  });
  if (error) redirect(`${PATH}?error=${encodeURIComponent(pesanPenugasan(error))}`);

  revalidatePath(PATH);
  redirect(`${PATH}?success=1`);
}

export async function unassignUser(formData: FormData) {
  const supabase = await requireAdmin();
  const user_id = String(formData.get("user_id") ?? "");
  const branch_id = String(formData.get("branch_id") ?? "");

  const { error } = await supabase.rpc("set_user_branch_assignment", {
    p_profile_id: user_id, p_branch_id: branch_id, p_assignment_role: "PRIMARY", p_remove: true,
  });
  if (error) redirect(`${PATH}?error=${encodeURIComponent(pesanPenugasan(error))}`);

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
