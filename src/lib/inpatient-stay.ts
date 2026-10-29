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

/** Kolom stay_type belum ada = migrasi K14 belum terpasang, jadi belum mungkin ada pet hotel. */
function isMissingStayColumn(error: { code?: string; message?: string }): boolean {
  return error.code === "42703" || /stay_type.*does not exist|column .*stay_type/i.test(error.message ?? "");
}

/**
 * Tipe per rawat inap. `failed` = tipe tidak terbaca karena alasan lain (koneksi, izin):
 * pemanggil yang memakai tipe untuk menegakkan aturan wajib menolak (fail closed).
 */
export async function readStayTypesChecked(db: Db, ids: string[]): Promise<{ types: Map<string, StayType>; failed: boolean }> {
  const types = new Map<string, StayType>();
  if (!ids.length) return { types, failed: false };
  const { data, error } = await db.from("inpatient_records").select("id, stay_type").in("id", ids);
  if (error) return { types, failed: !isMissingStayColumn(error) };
  if (!Array.isArray(data)) return { types, failed: true };
  for (const row of data as { id: string; stay_type?: unknown }[]) types.set(row.id, stayTypeOf(row.stay_type));
  return { types, failed: false };
}

/**
 * Rawat inap yang menuntut persetujuan khusus Rawat Inap di kasir: hanya tipe "sakit".
 * Pet hotel (hewan sehat) tidak (keputusan owner 29 Okt). Database tanpa kolom stay_type
 * (migrasi K14 belum terpasang) = semua rawat inap dianggap sakit, seperti dulu.
 * Bentuk hasil sama dengan `.maybeSingle()` supaya pemanggil tetap fail closed pada `error`.
 */
export async function readConsentStay(
  db: Pick<Db, "from">, visitId: string,
): Promise<{ data: { id: string; consent_id: string | null } | null; error: { code?: string; message?: string } | null }> {
  const typed = await db.from("inpatient_records").select("id, consent_id")
    .eq("visit_id", visitId).eq("stay_type", "sakit").limit(1).maybeSingle();
  if (typed.error && isMissingStayColumn(typed.error)) {
    return await db.from("inpatient_records").select("id, consent_id").eq("visit_id", visitId).limit(1).maybeSingle();
  }
  return typed;
}

/** Untuk tampilan saja: gagal baca = tampil sebagai bawaan "sakit". */
export async function readStayTypes(db: Db, ids: string[]): Promise<Map<string, StayType>> {
  return (await readStayTypesChecked(db, ids)).types;
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
