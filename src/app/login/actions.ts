"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { branchCookie } from "@/lib/operational-context";

export async function login(formData: FormData) {
  const store = await cookies();
  store.delete(branchCookie("klinik"));
  store.delete(branchCookie("petshop"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
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
