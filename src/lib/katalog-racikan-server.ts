import { createClient } from "@/lib/supabase/server";
import { katalogFromRows, type BahanKatalog, type KatalogRacikan } from "@/lib/katalog-racikan";
import { ListLoadError, readCompleteList } from "@/lib/checked-list";

type FormulaRow = { id: string; code: string; active: boolean; current_version_id: string | null; sale_item_id: string | null };
type VersionRow = { id: string; version: number; name: string; dosage_form: string; dosage_instruction: string | null; ingredients: BahanKatalog[] };

export async function loadKatalogRacikan(includeInactive = false): Promise<KatalogRacikan[]> {
  const supabase = await createClient();
  const formulas = await readCompleteList<FormulaRow>((from, to) => {
    let query = supabase.from("compound_formulas")
      .select("id, code, active, current_version_id, sale_item_id", { count: "exact" });
    if (!includeInactive) query = query.eq("active", true);
    return query.order("code").order("id").range(from, to);
  }, "Katalog racikan");
  const versionIds = [...new Set(formulas.map(f => f.current_version_id).filter((id): id is string => !!id))];
  const versions: VersionRow[] = [];
  // Resolve only the stored current versions, in small batches to bound URLs.
  // A missing or unreadable version must not look like an empty catalogue.
  for (let start = 0; start < versionIds.length; start += 200) {
    const batch = versionIds.slice(start, start + 200);
    const rows = await readCompleteList<VersionRow>((from, to) => supabase
      .from("compound_formula_versions")
      .select("id, version, name, dosage_form, dosage_instruction, ingredients", { count: "exact" })
      .in("id", batch).order("id").range(from, to), "Versi katalog racikan");
    const loadedIds = new Set(rows.map(row => row.id));
    if (rows.length !== batch.length || batch.some(id => !loadedIds.has(id))) {
      throw new ListLoadError("Versi katalog racikan belum dapat dimuat lengkap. Coba muat ulang.");
    }
    versions.push(...rows);
  }
  return katalogFromRows(formulas, versions);
}

export async function bolehRacikKhusus(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (data?.is_active !== true) return false;
  if (data.role === "OWNER" || data.role === "ADMIN") return true;
  if (data.role !== "DOCTOR") return false;
  const { data: ready, error } = await supabase.rpc("clinic_doctor_custom_compound_supported");
  return !error && ready === true;
}
