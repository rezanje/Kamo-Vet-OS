/**
 * Catatan pilihan promo kasir untuk struk dan pratinjau (hanya tampilan; uangnya ada di baris struk).
 * Hanya pilihan eksplisit yang dicatat: transaksi otomatis (atau data lama tanpa kolom pilihan) tidak mendapat catatan.
 */
export const CATATAN_PROMO_DIBATALKAN = "Promo dibatalkan oleh kasir";

const MAX_NAMA = 80;

export function pesanPilihanPromo(mode: unknown, selection: unknown): string | null {
  if (mode === "tanpa") return CATATAN_PROMO_DIBATALKAN;
  if (mode !== "pilih") return null;
  const applied = selection && typeof selection === "object" ? (selection as { applied?: unknown }).applied : null;
  const first = Array.isArray(applied) ? applied[0] : null;
  const name = first && typeof first === "object" ? (first as { name?: unknown }).name : null;
  const nama = typeof name === "string" ? name.trim().slice(0, MAX_NAMA) : "";
  return nama ? `Promo dipilih kasir: ${nama} (hanya promo ini)` : "Promo dipilih kasir (hanya promo ini)";
}
