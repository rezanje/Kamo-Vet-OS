export type CampaignBindingType = "transaction_voucher" | "product_promo";
export type CampaignCalculationMode = "existing_voucher" | "existing_promo" | null;

export type CampaignBindingInput = {
  code: string;
  bindingType: CampaignBindingType;
  targetId: string;
  calculationMode: CampaignCalculationMode;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCampaignBinding(form: FormData): CampaignBindingInput {
  const code = String(form.get("code") ?? "").toUpperCase().replace(/\s+/g, "");
  const bindingType = String(form.get("binding_type") ?? "");
  const targetId = String(form.get("target_id") ?? "");
  const mode = String(form.get("calculation_mode") ?? "");
  if (!code || code.length > 24 || !/^[A-Z0-9_-]+$/.test(code)) throw new Error("Kode kampanye harus 1–24 huruf, angka, garis bawah atau minus.");
  if (bindingType !== "transaction_voucher" && bindingType !== "product_promo") throw new Error("Pilih jenis relasi kampanye.");
  if (!UUID.test(targetId)) throw new Error("Pilih voucher atau promo sumber yang valid.");
  if (mode && mode !== (bindingType === "transaction_voucher" ? "existing_voucher" : "existing_promo")) {
    throw new Error("Mode perhitungan tidak cocok dengan sumber kampanye.");
  }
  return { code, bindingType, targetId, calculationMode: mode as CampaignCalculationMode || null };
}

export function campaignBindingReadiness(mode: CampaignCalculationMode): string {
  if (mode === "existing_voucher") return "Alias voucher transaksi aktif untuk kasir petshop dan pembayaran satu kunjungan klinik. Pembayaran rombongan belum mendukung alias.";
  if (mode === "existing_promo") return "Relasi promo tersimpan untuk peninjauan. Kode belum dapat diredeem di kasir.";
  return "Mode perhitungan belum dipilih. Kode tidak dapat diredeem di kasir.";
}
