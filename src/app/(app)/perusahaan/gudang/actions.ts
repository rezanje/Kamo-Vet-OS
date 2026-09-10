"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const PATH = "/perusahaan/gudang";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`${PATH}?error=${encodeURIComponent("Hanya owner/admin yang bisa mengatur gudang")}`);
  }
  return supabase;
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
