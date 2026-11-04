import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorNames } from "./transaction-history";

/**
 * Nama pelaku untuk riwayat. Dibaca lewat RLS profiles (diri sendiri, atau semua untuk OWNER/ADMIN),
 * jadi pelaku lain tetap anonim bagi peran lain. Gagal baca TIDAK melempar: halaman tetap tampil dan
 * riwayatnya hanya menyebut "Pengguna lain".
 */
export async function loadActorNames(db: SupabaseClient, ids: readonly (string | null | undefined)[]): Promise<{ names: ActorNames; error: boolean }> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return { names: new Map(), error: false };
  try {
    const { data, error } = await db.from("profiles").select("id, full_name").in("id", unique);
    if (error || !Array.isArray(data)) return { names: new Map(), error: true };
    return { names: new Map((data as { id: string; full_name: string | null }[]).filter((row) => row.full_name).map((row) => [row.id, row.full_name as string])), error: false };
  } catch {
    return { names: new Map(), error: true };
  }
}
