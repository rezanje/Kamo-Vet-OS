"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MODULES } from "@/lib/nav";
import { modulBawaan, SEMUA_PERAN } from "@/lib/akses";

const BASE = "/pengaturan/akses-grup";
const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

/**
 * Mengubah hak akses HANYA boleh oleh OWNER — keputusan boss 2026-08-03.
 * Dijaga juga oleh RLS di migrasi 0101; ini lapis kedua supaya pesannya jelas
 * dan bukan sekadar error database.
 */
async function assertOwner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER") gagal("Hanya pemilik yang boleh mengubah hak akses");
  return supabase;
}

function peranValid(role: string): boolean {
  return (SEMUA_PERAN as readonly string[]).includes(role) && role !== "OWNER";
}

/** Simpan centang modul satu peran. Tanpa satu pun modul = peran itu tidak bisa masuk ke mana-mana. */
export async function simpanAksesPeran(formData: FormData) {
  const supabase = await assertOwner();

  const role = String(formData.get("role") ?? "").trim();
  // OWNER sengaja ditolak: dia selalu penuh, dan mengizinkan pembatasan di sini
  // berarti pemilik bisa mengunci dirinya sendiri keluar tanpa jalan kembali.
  if (!peranValid(role)) gagal("Peran tidak dikenal, atau memang tidak bisa dibatasi");

  const idModulSah = new Set(MODULES.map((m) => m.id));
  const dipilih = [...formData.keys()]
    .filter((k) => k.startsWith("mod_") && String(formData.get(k)) === "on")
    .map((k) => k.slice("mod_".length))
    .filter((id) => idModulSah.has(id));

  if (dipilih.length === 0) {
    gagal("Pilih minimal satu modul — peran tanpa modul sama sekali tidak bisa membuka apa pun");
  }

  // Ganti seluruh baris peran itu: centang yang dilepas harus benar-benar hilang,
  // bukan menumpuk dengan yang lama.
  const { error: hapusErr } = await supabase.from("role_modules").delete().eq("role", role);
  if (hapusErr) gagal(hapusErr.message);

  const { error } = await supabase.from("role_modules")
    .insert(dipilih.map((module_id) => ({ role, module_id })));
  if (error) gagal(error.message);

  redirect(`${BASE}?success=${encodeURIComponent(`Hak akses ${role} disimpan.`)}&peran=${role}`);
}

/** Kembalikan satu peran ke aturan bawaan (hapus seluruh barisnya). */
export async function kembalikanBawaan(formData: FormData) {
  const supabase = await assertOwner();

  const role = String(formData.get("role") ?? "").trim();
  if (!peranValid(role)) gagal("Peran tidak dikenal");

  const { error } = await supabase.from("role_modules").delete().eq("role", role);
  if (error) gagal(error.message);

  redirect(`${BASE}?success=${encodeURIComponent(`${role} kembali ke aturan bawaan.`)}&peran=${role}`);
}

/** Mulai mengatur sendiri: seed baris dari aturan bawaan supaya tidak mulai dari kosong. */
export async function mulaiAturSendiri(formData: FormData) {
  const supabase = await assertOwner();

  const role = String(formData.get("role") ?? "").trim();
  if (!peranValid(role)) gagal("Peran tidak dikenal");

  const bawaan = modulBawaan(role) ?? MODULES.map((m) => m.id);
  const { error } = await supabase.from("role_modules")
    .upsert(bawaan.map((module_id) => ({ role, module_id })), { onConflict: "role,module_id" });
  if (error) gagal(error.message);

  redirect(`${BASE}?success=${encodeURIComponent(`${role} sekarang diatur sendiri — silakan sesuaikan centangnya.`)}&peran=${role}`);
}
