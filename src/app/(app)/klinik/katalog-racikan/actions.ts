"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const back = "/klinik/katalog-racikan";
const gagal = (message: string) => redirect(`${back}?error=${encodeURIComponent(message)}`);

export async function publishKatalogRacikan(formData: FormData) {
  const supabase = await createClient();
  let ingredients: unknown;
  try {
    ingredients = JSON.parse(String(formData.get("ingredients") ?? "[]"));
  } catch {
    return gagal("Daftar bahan tidak valid.");
  }
  const { error } = await supabase.rpc("publish_compound_formula", {
    p_formula_id: String(formData.get("formula_id") ?? "") || null,
    p_code: String(formData.get("code") ?? ""),
    p_name: String(formData.get("name") ?? ""),
    p_dosage_form: String(formData.get("dosage_form") ?? ""),
    p_dosage_instruction: String(formData.get("dosage_instruction") ?? ""),
    p_ingredients: ingredients,
  });
  if (error) return gagal(error.message.startsWith("RECIPE_INVALID:") || error.message.startsWith("INGREDIENT_INVALID:")
    ? error.message.split(": ").slice(1).join(": ") : "Katalog gagal diterbitkan. Periksa kode, bahan, dan hak akses.");
  revalidatePath(back);
  redirect(`${back}?success=publish`);
}

export async function setKatalogRacikanAktif(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_compound_formula_active", {
    p_formula_id: String(formData.get("formula_id") ?? ""),
    p_active: String(formData.get("active") ?? "") === "true",
  });
  if (error) return gagal("Status katalog gagal diubah. Periksa hak akses.");
  revalidatePath(back);
  redirect(`${back}?success=status`);
}
