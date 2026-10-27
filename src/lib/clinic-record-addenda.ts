import type { SupabaseClient } from "@supabase/supabase-js";

/** K01: append-only diagnosis/therapy note on a billed medical record. */
export type RecordAddendum = {
  id: string; diagnosis_addendum: string | null; therapy_addendum: string | null; reason: string | null;
  created_at: string; created_by: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null;
};
/** "missing" = database step not applied yet: hide the feature instead of failing the page. */
export type AddendaLoad = { state: "ok" | "missing" | "error"; rows: RecordAddendum[] };

const MAX_ROWS = 500;
const NOT_INSTALLED = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);

export function isAddendaNotInstalled(error: { code?: string } | null | undefined) {
  return !!error?.code && NOT_INSTALLED.has(error.code);
}

export async function loadRecordAddenda(supabase: SupabaseClient, recordId: string): Promise<AddendaLoad> {
  try {
    const { data, error, count } = await supabase.from("clinic_record_addenda")
      .select("id, diagnosis_addendum, therapy_addendum, reason, created_at, created_by, profiles(full_name)", { count: "exact" })
      .eq("medical_record_id", recordId).order("created_at").order("id").limit(MAX_ROWS);
    if (error) return { state: isAddendaNotInstalled(error) ? "missing" : "error", rows: [] };
    const rows = (data ?? []) as RecordAddendum[];
    if (typeof count !== "number" || count !== rows.length) return { state: "error", rows: [] };
    return { state: "ok", rows };
  } catch {
    return { state: "error", rows: [] };
  }
}

export function addendumAuthor(row: RecordAddendum) {
  const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return p?.full_name ?? "Pengguna tidak tercatat";
}
