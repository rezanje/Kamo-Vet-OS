import { createClient } from "@/lib/supabase/server";
import { katalogFromRows, type BahanKatalog, type KatalogRacikan } from "@/lib/katalog-racikan";

export async function loadKatalogRacikan(includeInactive = false): Promise<KatalogRacikan[]> {
  const supabase = await createClient();
  let query = supabase.from("compound_formulas")
    .select("id, code, active, current_version_id").order("code");
  if (!includeInactive) query = query.eq("active", true);
  const { data: formulas, error } = await query;
  if (error) throw new Error("Katalog racikan belum bisa dimuat.");
  const versionIds = (formulas ?? []).map((f) => f.current_version_id).filter((id): id is string => !!id);
  if (!versionIds.length) return [];
  const { data: versions, error: versionError } = await supabase
    .from("compound_formula_versions")
    .select("id, version, name, dosage_form, dosage_instruction, ingredients")
    .in("id", versionIds);
  if (versionError || (versions ?? []).length !== versionIds.length) {
    throw new Error("Versi katalog racikan belum bisa dimuat.");
  }
  return katalogFromRows(formulas ?? [], (versions ?? []).map((v) => ({
    ...v, ingredients: v.ingredients as BahanKatalog[],
  })));
}

export async function bolehRacikKhusus(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "OWNER" || data?.role === "ADMIN";
}
