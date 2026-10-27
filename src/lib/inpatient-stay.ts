// K14: tipe rawat inap. K06: kunjungan lanjutan rawat inap dari kunjungan yang sudah lunas.
// Semua pembacaan di sini toleran terhadap database yang belum menjalankan migrasi
// 20261028120000: kolom baru yang belum ada dibaca sebagai nilai bawaan, bukan error halaman.
import type { createClient } from "@/lib/supabase/server";

export type StayType = "sakit" | "pet_hotel";

export const STAY_TYPES: readonly StayType[] = ["sakit", "pet_hotel"];

export const STAY_TYPE_LABEL: Record<StayType, string> = {
  sakit: "Rawat inap (sakit)",
  pet_hotel: "Pet hotel (sehat)",
};

export function stayTypeOf(value: unknown): StayType {
  return value === "pet_hotel" ? "pet_hotel" : "sakit";
}

export function parseStayType(value: FormDataEntryValue | null): StayType | null {
  const raw = String(value ?? "sakit").trim() || "sakit";
  return (STAY_TYPES as readonly string[]).includes(raw) ? (raw as StayType) : null;
}

/** Pesan RPC "fungsi tidak ditemukan": database belum menjalankan migrasi K06/K14. */
export function isMissingRpc(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === "PGRST202" || error.code === "42883");
}

type Db = Awaited<ReturnType<typeof createClient>>;

export async function readStayTypes(db: Db, ids: string[]): Promise<Map<string, StayType>> {
  const map = new Map<string, StayType>();
  if (!ids.length) return map;
  const { data, error } = await db.from("inpatient_records").select("id, stay_type").in("id", ids);
  if (error || !Array.isArray(data)) return map;
  for (const row of data as { id: string; stay_type?: unknown }[]) map.set(row.id, stayTypeOf(row.stay_type));
  return map;
}

export type VisitContinuation = {
  sourceVisit: { id: string; created_at: string } | null;
  continuations: { id: string; created_at: string; status: string }[];
};

export async function readVisitContinuation(db: Db, visitId: string): Promise<VisitContinuation> {
  const [self, next] = await Promise.all([
    db.from("visits").select("continued_from_visit_id").eq("id", visitId).maybeSingle(),
    db.from("visits").select("id, created_at, status").eq("continued_from_visit_id", visitId).order("created_at"),
  ]);
  const sourceId = !self.error && self.data && !Array.isArray(self.data)
    ? (self.data as { continued_from_visit_id?: string | null }).continued_from_visit_id ?? null : null;
  let sourceVisit: VisitContinuation["sourceVisit"] = null;
  if (sourceId) {
    const { data } = await db.from("visits").select("id, created_at").eq("id", sourceId).maybeSingle();
    sourceVisit = data && !Array.isArray(data) ? data as { id: string; created_at: string } : { id: sourceId, created_at: "" };
  }
  const continuations = !next.error && Array.isArray(next.data)
    ? (next.data as { id: string; created_at: string; status: string }[]).filter(row => row.id !== visitId) : [];
  return { sourceVisit, continuations };
}
