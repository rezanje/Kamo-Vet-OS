/**
 * Diskon manual hanya Owner/Admin (permintaan Aldi, 12 Nov 2026).
 *
 * Hak dibaca dari database (`manual_discount_allowed`, migrasi 20261115700000): OWNER selalu; peran tanpa kebijakan tersimpan
 * hanya ADMIN; peran berkebijakan bila Owner mencentang izin `kasir.diskon_manual` di Pengaturan › Akses Grup.
 *
 * Yang dihitung "diskon manual" = angka yang DIKETIK kasir: potongan per barang / diskon total (kasir petshop) dan diskon % per baris /
 * diskon total (tagihan klinik). Promo, voucher, kode kampanye, poin, diskon golongan member, dan diskon bawaan barang dari master
 * (items.default_discount) bukan diskon manual dan tetap jalan untuk semua kasir.
 */
export const MANUAL_DISCOUNT_ACTION = "kasir.diskon_manual";

export const PESAN_DISKON_MANUAL_DITOLAK =
  "Diskon manual hanya bisa diberikan Owner/Admin. Hapus diskon yang diketik lalu bayar lagi; promo, voucher, poin, dan diskon member tetap berlaku otomatis.";

type RpcClient = { rpc(name: "manual_discount_allowed"): PromiseLike<{ data: unknown; error: unknown }> };

/** Fail-closed: galat/tak terbaca = tidak boleh. Tidak pernah melempar. */
export async function manualDiscountAllowed(client: RpcClient): Promise<boolean> {
  try {
    const { data, error } = await client.rpc("manual_discount_allowed");
    return !error && data === true;
  } catch {
    return false;
  }
}

const pos = (n: unknown) => Math.max(0, Number(n) || 0);
const sama = (a: number, b: number) => Math.abs(a - b) < 1e-9;

export type KasirDiscountLine = { item_id?: string | null; item_discount_type?: "nominal" | "percent" | null; item_discount_value?: number | null };

/**
 * Kasir petshop: boleh ada potongan per barang HANYA bila persis diskon bawaan master barang itu (persen). Diskon total wajib 0.
 * `defaults` = items.default_discount per item_id (dibaca server, bukan dari layar).
 */
export function kasirManualDiscountUsed(transactionDiscount: number, lines: readonly KasirDiscountLine[], defaults: ReadonlyMap<string, number>): boolean {
  if (pos(transactionDiscount) > 0) return true;
  return lines.some((line) => {
    const value = pos(line.item_discount_value);
    if (value === 0) return false;
    const bawaan = line.item_id ? pos(defaults.get(line.item_id)) : 0;
    return !(line.item_discount_type === "percent" && bawaan > 0 && sama(value, bawaan));
  });
}

export type ClinicDiscountLine = { diskon_persen?: number | null; source_invoice_item_id?: string | null };

/**
 * Tagihan klinik: tagihan baru wajib tanpa diskon manual. Koreksi tagihan lama boleh MEMPERTAHANKAN atau MENGURANGI diskon yang sudah
 * diberikan Owner/Admin (per baris asal dan diskon total), tidak boleh menambah. `storedLine` = diskon_persen tersimpan per invoice_items.id.
 */
export function clinicManualDiscountRaised(
  transactionDiscount: number,
  lines: readonly ClinicDiscountLine[],
  existing: { discount: number; storedLine: ReadonlyMap<string, number> } | null,
): boolean {
  if (pos(transactionDiscount) > (existing ? pos(existing.discount) : 0) + 1e-9) return true;
  return lines.some((line) => {
    const value = pos(line.diskon_persen);
    if (value === 0) return false;
    const stored = existing && line.source_invoice_item_id ? pos(existing.storedLine.get(line.source_invoice_item_id)) : 0;
    return value > stored + 1e-9;
  });
}
