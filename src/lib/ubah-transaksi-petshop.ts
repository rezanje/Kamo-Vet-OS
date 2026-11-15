/**
 * Struk petshop yang penerimaannya dibatalkan hanya bisa diubah isinya lewat "Batalkan penjualan" (aturan lama cancel_posted_sale), yang MENOLAK struk:
 * - memakai voucher atau item promo (kuota promo harus direkonsiliasi dulu), atau
 * - bulan penggajiannya sudah dibuat (komisi sudah dibekukan).
 * Fungsi murni ini dipakai halaman struk untuk memperingatkan Owner SEBELUM membatalkan penerimaan, supaya tidak terjebak di struk "belum dibayar"
 * yang isinya tak bisa diubah. Ini hanya peringatan: tidak menolak apa pun (Owner tidak dikunci).
 */
export type UbahTransaksiInput = { voucherCode: string | null | undefined; promoItemCount: number; payrollMonthExists: boolean };

export function alasanUbahTransaksiTerhalang(input: UbahTransaksiInput): string[] {
  const alasan: string[] = [];
  if ((input.voucherCode ?? "").trim() !== "") alasan.push("struk ini memakai voucher");
  if (input.promoItemCount > 0) alasan.push("struk ini berisi item promo");
  if (input.payrollMonthExists) alasan.push("penggajian bulan struk ini sudah dibuat");
  return alasan;
}

export function bulanJakarta(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).formatToParts(new Date(iso));
  return `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}`;
}
