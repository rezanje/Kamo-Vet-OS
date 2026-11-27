import { allowedBranchIds } from "@/lib/branch-access";

/** Cabang tempat jurnal pembayaran hutang dibukukan. Hutang (faktur) tetap milik cabang faktur. */
export type CabangPembukuan = { id: string; name: string };

export const TEKS_CABANG_PEMBUKUAN = "Jurnal pembayaran dicatat di cabang ini. Hutang tetap milik cabang faktur.";

/**
 * Cabang aktif yang boleh dipilih pemakai. Gagal baca = daftar kosong: pilihan disembunyikan
 * dan pembayaran tetap dibukukan di cabang faktur (perilaku lama). Database memeriksa ulang.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function muatCabangPembukuan(supabase: any, userId: string): Promise<CabangPembukuan[]> {
  if (!userId) return [];
  const [{ data, error }, allowed] = await Promise.all([
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    allowedBranchIds(supabase, userId),
  ]);
  if (error || !Array.isArray(data)) return [];
  const rows = data as CabangPembukuan[];
  return allowed === null ? rows : rows.filter((b) => allowed.includes(b.id));
}

/** Nilai kolom form -> argumen RPC: kosong = cabang faktur (null). */
export function bacaCabangPembukuan(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}
