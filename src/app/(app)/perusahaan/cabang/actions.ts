"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { roleRpcFailure } from "@/lib/role-action-access";
import { pesanGalat, rapikanNama, validasiNamaCabang } from "@/lib/cabang-gudang-edit";

const PATH = "/perusahaan/cabang";
// Never show the raw database message: known role/people codes map to Indonesian, the rest is generic.
const pesanPenugasan = (error: unknown) => roleRpcFailure(error)?.message ?? "Penugasan cabang gagal disimpan. Tidak ada perubahan yang dipastikan tersimpan; muat ulang halaman lalu coba lagi.";

// Friendly early manager gate only. The bounded RPC is authoritative, retains
// the original account target/branch ceilings and writes the account audit.
// Direct authenticated user_branches writes are deliberately rejected.
async function requireAdmin(pesan = "Hanya owner/admin yang bisa mengatur pengguna cabang") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`${PATH}?error=${encodeURIComponent(pesan)}`);
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

const gagal = (pesan: string): never => redirect(`${PATH}?error=${encodeURIComponent(pesan)}`);

function segarkan() {
  revalidatePath(PATH);
  revalidatePath("/perusahaan/gudang");
  revalidatePath("/pengaturan/cabang");
}

/**
 * Ubah nama (wajib), kode (hanya bila dikirim), dan status cabang. OWNER/ADMIN; jenis cabang tidak bisa diubah.
 * Pengaman sebenarnya: update_branch_info (peran, nama unik, kode terkunci bila ada transaksi, shift/antrian terbuka).
 */
export async function ubahCabang(formData: FormData) {
  const supabase = await requireAdmin("Hanya owner/admin yang bisa mengubah cabang");
  const id = String(formData.get("id") ?? "").trim();
  const salahNama = validasiNamaCabang(formData.get("name"));
  if (!id) gagal("Cabang tidak valid");
  if (salahNama) gagal(salahNama);
  const nama = rapikanNama(formData.get("name"));
  const kode = String(formData.get("code") ?? "").trim() || null;
  const { error } = await supabase.rpc("update_branch_info", { p_id: id, p_name: nama, p_code: kode, p_is_active: null });
  if (error) gagal(pesanGalat(error));
  segarkan();
  redirect(`${PATH}?success=${encodeURIComponent(`Cabang ${nama} tersimpan`)}`);
}

/** Nonaktifkan / aktifkan cabang tanpa menyentuh nama dan kode. */
export async function aturStatusCabang(formData: FormData) {
  const supabase = await requireAdmin("Hanya owner/admin yang bisa mengubah cabang");
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("is_active") ?? "");
  if (!id || !["1", "0"].includes(status)) gagal("Pilih status cabang yang valid");
  const { error } = await supabase.rpc("update_branch_info", { p_id: id, p_name: null, p_code: null, p_is_active: status === "1" });
  if (error) gagal(pesanGalat(error));
  segarkan();
  redirect(`${PATH}?success=${encodeURIComponent(status === "1" ? "Cabang diaktifkan" : "Cabang dinonaktifkan")}`);
}
