import type { SupabaseClient } from "@supabase/supabase-js";

export type RacikanKunjungan = { id: string; recipe_name: string; status: string; created_at: string };

export const STATUS_RACIKAN: Record<string, { label: string; bisaAksi: boolean; alasan: string | null }> = {
  pending: { label: "Menunggu diracik", bisaAksi: true, alasan: null },
  ready: { label: "Siap diserahkan", bisaAksi: true, alasan: null },
  handed_over: {
    label: "Sudah diserahkan", bisaAksi: false,
    alasan: "Racikan sudah diserahkan ke pasien, jadi bahannya tidak bisa dikembalikan. Bila ada kesalahan, hubungi Owner/Reza.",
  },
  void: { label: "Void", bisaAksi: false, alasan: "Racikan ini sudah dikembalikan bahannya (void); tidak ada yang perlu dikoreksi lagi." },
};

export function infoStatusRacikan(status: string) {
  return STATUS_RACIKAN[status] ?? {
    label: status, bisaAksi: false,
    alasan: "Status racikan tidak dikenali, jadi tombol koreksi tidak ditampilkan. Hubungi Owner/Reza.",
  };
}

/** Satu query (tanpa N+1). Gagal/terpotong = null → UI menulis "tidak terbaca", bukan "belum ada". */
export async function bacaRacikanKunjungan(supabase: Pick<SupabaseClient, "from">, visitId: string): Promise<RacikanKunjungan[] | null> {
  try {
    const { data, error } = await supabase.from("compounding_recipes")
      .select("id, recipe_name, status, created_at, medical_records!inner(visit_id)")
      .eq("medical_records.visit_id", visitId)
      .order("created_at", { ascending: true });
    if (error || !Array.isArray(data)) return null;
    return data.map(row => ({ id: String(row.id), recipe_name: String(row.recipe_name ?? ""), status: String(row.status ?? ""), created_at: String(row.created_at ?? "") }));
  } catch {
    return null;
  }
}
