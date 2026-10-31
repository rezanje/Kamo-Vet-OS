import { parseClinicPostingError } from "@/lib/klinik-posting";

/**
 * Pelunasan tagihan rawat jalan yang masih DP/Belum Lunas oleh kasir klinik.
 * Uangnya dicatat writer kwitansi asli (`clinic_receive_visit_payment`) lewat pembungkus
 * `clinic_settle_outpatient_invoice`, pada invoice yang SAMA dan laci shift kasir sendiri.
 */
export const METODE_PELUNASAN = ["Tunai", "Transfer", "QRIS", "Debit", "Kredit", "E-Wallet"] as const;
export type MetodePelunasan = (typeof METODE_PELUNASAN)[number];
export type BagianPelunasan = { method: MetodePelunasan; amount: number };

/** Sisa tagihan: total dikurangi uang yang sudah menempel SATU kali (DP kepala + pembayaran bersih). */
export function sisaTagihan(total: number, diterima: number): number {
  return Math.max(0, Math.round(Number(total) - Number(diterima)));
}

/** Validasi isian layar. Basis data memeriksa ulang semuanya di bawah kunci. */
export function parseBagianPelunasan(raw: string): BagianPelunasan[] {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error("Rincian pembayaran tidak terbaca. Muat ulang halaman."); }
  if (!Array.isArray(data) || data.length < 1 || data.length > 6) throw new Error("Isi satu sampai enam bagian pembayaran.");
  return data.map((part) => {
    const method = (part as { method?: unknown })?.method;
    const amount = Number((part as { amount?: unknown })?.amount);
    if (!METODE_PELUNASAN.includes(method as MetodePelunasan)) throw new Error("Metode pembayaran tidak valid.");
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Nominal pembayaran harus rupiah bulat lebih dari nol.");
    return { method: method as MetodePelunasan, amount };
  });
}

export function totalBagian(parts: { amount: number }[]): number {
  return parts.reduce((sum, part) => sum + (Number(part.amount) || 0), 0);
}

const SETTLE_DETAIL = /^SETTLE_INVALID:\s*([^\r\n]{1,100})$/;
const REMAINING = /^REMAINING_CHANGED:\s*([^\r\n]{1,100})$/;

/** Pesan penolakan pelunasan dalam bahasa kasir; galat tak dikenal tidak dibocorkan. */
export function pesanPelunasanGagal(error: { code?: string; message: string } | null): string {
  if (error?.code === "P0001") {
    const sisa = REMAINING.exec(error.message);
    if (sisa) return `Sisa tagihan sudah berubah (${sisa[1]}). Muat ulang halaman dan periksa lagi; pelunasan ini belum tersimpan.`;
    const settle = SETTLE_DETAIL.exec(error.message);
    if (settle) return `Pelunasan ditolak: ${settle[1]}. Tidak ada uang yang tersimpan.`;
    if (error.message.startsWith("PAYMENT_INVALID:")) return "Nominal pelunasan tidak valid atau melebihi sisa tagihan. Tidak ada uang yang tersimpan.";
    if (error.message.startsWith("IDEMPOTENCY_CONFLICT:")) return "Permintaan pelunasan ini sudah dipakai untuk isian berbeda. Muat ulang halaman sebelum menerima uang.";
  }
  return parseClinicPostingError(error,
    "Hasil pelunasan belum dapat dipastikan. Muat ulang dan periksa status tagihan sebelum mencoba lagi; jangan menerima uang dua kali.");
}
