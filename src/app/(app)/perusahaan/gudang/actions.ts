"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { keputusanHapusGudang, pesanGalat, rapikanNama, validasiAlasanHapus, validasiNamaGudang } from "@/lib/cabang-gudang-edit";

const PATH = "/perusahaan/gudang";

async function requireRole(roles: string[], pesan: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !roles.includes(me.role)) {
    redirect(`${PATH}?error=${encodeURIComponent(pesan)}`);
  }
  return { supabase, role: me.role as string };
}

async function requireAdmin() {
  return (await requireRole(["OWNER", "ADMIN"], "Hanya owner/admin yang bisa mengatur gudang")).supabase;
}

export async function tambahGudang(formData: FormData) {
  const supabase = await requireAdmin();
  const branch_id = String(formData.get("branch_id") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();
  const validTypes = ["RETAIL", "VET", "EXPIRED", "TRANSIT", "ONLINE", "DC"];

  if (!branch_id || !code || !name || !validTypes.includes(type)) {
    redirect(`${PATH}?error=${encodeURIComponent("Lengkapi cabang, kode, nama, dan jenis gudang")}`);
  }

  const { data: branch } = await supabase
    .from("branches").select("id").eq("id", branch_id).eq("is_active", true).maybeSingle();
  if (!branch) redirect(`${PATH}?error=${encodeURIComponent("Cabang tujuan tidak tersedia")}`);

  const { error } = await supabase
    .from("warehouses")
    .insert({ branch_id, code, name, type, is_active: true });
  if (error) {
    const message = error.code === "23505"
      ? "Kode gudang sudah dipakai. Gunakan kode lain atau cek daftar gudang."
      : "Gudang belum dapat disimpan. Coba lagi.";
    redirect(`${PATH}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(PATH);
  redirect(`${PATH}?success=${encodeURIComponent(`Gudang ${name} sudah dibuat`)}`);
}

const gagal = (pesan: string): never => redirect(`${PATH}?error=${encodeURIComponent(pesan)}`);
const VALID_TYPES = ["RETAIL", "VET", "EXPIRED", "TRANSIT", "ONLINE", "DC"];

/** Ubah nama (wajib), kode dan jenis (hanya bila dikirim; database menolak bila gudang sudah dipakai). OWNER/ADMIN. */
export async function ubahGudang(formData: FormData) {
  const { supabase } = await requireRole(["OWNER", "ADMIN"], "Hanya owner/admin yang bisa mengubah gudang");
  const id = String(formData.get("id") ?? "").trim();
  const salahNama = validasiNamaGudang(formData.get("name"));
  if (!id) gagal("Gudang tidak valid");
  if (salahNama) gagal(salahNama);
  const nama = rapikanNama(formData.get("name"));
  const kode = String(formData.get("code") ?? "").trim() || null;
  const jenis = String(formData.get("type") ?? "").trim() || null;
  if (jenis && !VALID_TYPES.includes(jenis)) gagal("Jenis gudang tidak dikenal");
  const { error } = await supabase.rpc("update_warehouse_info", { p_id: id, p_name: nama, p_code: kode, p_type: jenis, p_is_active: null });
  if (error) gagal(pesanGalat(error));
  revalidatePath(PATH);
  redirect(`${PATH}?success=${encodeURIComponent(`Gudang ${nama} tersimpan`)}`);
}

/** Nonaktifkan / aktifkan gudang (stok, dokumen terbuka, dan gudang terakhir dijaga database). */
export async function aturStatusGudang(formData: FormData) {
  const { supabase } = await requireRole(["OWNER", "ADMIN"], "Hanya owner/admin yang bisa mengubah gudang");
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("is_active") ?? "");
  if (!id || !["1", "0"].includes(status)) gagal("Pilih status gudang yang valid");
  const { error } = await supabase.rpc("update_warehouse_info", { p_id: id, p_name: null, p_code: null, p_type: null, p_is_active: status === "1" });
  if (error) gagal(pesanGalat(error));
  revalidatePath(PATH);
  redirect(`${PATH}?success=${encodeURIComponent(status === "1" ? "Gudang diaktifkan" : "Gudang dinonaktifkan")}`);
}

/** Hapus gudang: hanya OWNER, alasan wajib, dan hanya bila belum dipakai sama sekali (diperiksa ulang di database). */
export async function hapusGudang(formData: FormData) {
  const { supabase, role } = await requireRole(["OWNER", "ADMIN"], "Hanya owner yang bisa menghapus gudang");
  const keputusan = keputusanHapusGudang(role, false);
  if (!keputusan.boleh) gagal(keputusan.alasan ?? "Hanya owner yang bisa menghapus gudang");
  const id = String(formData.get("id") ?? "").trim();
  const salahAlasan = validasiAlasanHapus(formData.get("reason"));
  if (!id) gagal("Gudang tidak valid");
  if (salahAlasan) gagal(salahAlasan);
  const { error } = await supabase.rpc("delete_warehouse", { p_id: id, p_reason: String(formData.get("reason")).trim() });
  if (error) gagal(pesanGalat(error));
  revalidatePath(PATH);
  redirect(`${PATH}?success=${encodeURIComponent("Gudang dihapus")}`);
}
