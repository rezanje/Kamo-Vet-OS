"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { branchCookie } from "@/lib/operational-context";
import { RUMAH_ADMIN_ONLINE, isAdminOnline } from "@/lib/admin-online";

export async function login(formData: FormData) {
  const store = await cookies();
  store.delete(branchCookie("klinik"));
  store.delete(branchCookie("petshop"));
  const supabase = await createClient();
  const { data: masuk, error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  // Admin Online langsung ke satu-satunya layarnya (impor penjualan online); gagal baca peran = jalur biasa (/mulai, yang juga mengarahkannya).
  if (masuk?.user?.id) {
    const { data: profil } = await supabase.from("profiles").select("role").eq("id", masuk.user.id).maybeSingle();
    if (isAdminOnline(profil?.role)) redirect(RUMAH_ADMIN_ONLINE);
  }
  // setelah login pilih mode kerja dulu: dashboard VetOS atau POS kasir.
  redirect("/mulai");
}

export async function logout() {
  const store = await cookies();
  store.delete(branchCookie("klinik"));
  store.delete(branchCookie("petshop"));
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
