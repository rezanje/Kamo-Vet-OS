/** Kebijakan nilai uang saldo awal Accurate; divalidasi ulang oleh prepare_accurate_initial_stock. */
export type InitialStockValuationPolicy = "ROUND_LINE_RUPIAH_V1" | "HALF_UP_BATCH_V1" | "STRICT";

/** Keputusan pemilik 29 Okt (checklist M04/M01): bulatkan per baris ke rupiah penuh. */
export const DEFAULT_VALUATION_POLICY: InitialStockValuationPolicy = "ROUND_LINE_RUPIAH_V1";

export const VALUATION_POLICY_OPTIONS: { value: InitialStockValuationPolicy; label: string; hint: string }[] = [
  {
    value: "ROUND_LINE_RUPIAH_V1",
    label: "Bulatkan nilai tiap baris ke rupiah penuh (keputusan pemilik, disarankan)",
    hint: "Nilai tiap baris = qty × HPP, dibulatkan ke rupiah terdekat. Total selisih terhadap file ditampilkan dan disimpan bersama batch.",
  },
  {
    value: "HALF_UP_BATCH_V1",
    label: "Bulatkan total batch ke 2 desimal",
    hint: "Kebijakan lama. Bisa ditolak bila sisa sen tidak dapat dititipkan tepat ke satu baris.",
  },
  {
    value: "STRICT",
    label: "Tanpa pembulatan",
    hint: "Batch ditolak bila ada nilai yang tidak tepat dua desimal.",
  },
];

export function valuationPolicyLabel(policy: string | null | undefined): string {
  return VALUATION_POLICY_OPTIONS.find(option => option.value === policy)?.label.replace(/ \(.*\)$/, "") ?? String(policy ?? "—");
}
