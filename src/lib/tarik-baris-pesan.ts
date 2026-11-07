/** Pesan galat "Tarik baris dari tagihan lunas (Owner)" dalam bahasa Indonesia sederhana.
 *  Kode di awal pesan RPC (mis. "COST_MISMATCH: ...") dipetakan ke kalimat yang dimengerti Owner/Reza. */
const PESAN: Record<string, string> = {
  ACCESS_DENIED: "Hanya Owner (cabang ini) yang boleh menarik baris dari tagihan lunas.",
  REASON_REQUIRED: "Alasan wajib diisi (minimal 5 huruf, maksimal 500).",
  LINE_INVALID: "Pilih baris yang valid dari tagihan ini.",
  PARTIAL_NOT_ALLOWED: "Baris hanya bisa ditarik penuh, belum bisa dikurangi jumlahnya.",
  RECIPE_LINKED: "Baris racikan tidak bisa ditarik dari sini. Hubungi tim keuangan.",
  COST_MISMATCH: "HPP baris tidak sama dengan biaya bahan/stok yang tercatat, jadi sistem tidak menebak. Hubungi Reza.",
  STOCK_MISMATCH: "Kartu stok tagihan tidak cocok dengan rincian baris, jadi sistem tidak menebak. Hubungi Reza.",
  LAST_LINE: "Tidak boleh menarik semua baris. Untuk membatalkan seluruh tagihan pakai Void & Terbitkan Ulang.",
  LINE_WITHDRAWN: "Resep baris ini sudah ditarik dari penagihan.",
  INVOICE_VOID: "Tagihan ini sudah dibatalkan.",
  INVOICE_NOT_PAID: "Tagihan belum lunas, atau uang mukanya sudah dilepas. Hanya tagihan lunas yang bisa ditarik barisnya.",
  INVOICE_ADJUSTED: "Tagihan ini punya diskon, pajak, DP, voucher, koreksi, atau bukan tagihan tahap rawat inap. Belum bisa ditarik barisnya dari sini.",
  PAYMENT_METHOD: "Tagihan ini tidak dibayar penuh lewat uang muka (ada tunai/transfer langsung). Belum didukung.",
  REFUND_EXISTS: "Tagihan ini sudah punya refund atau permintaan refund.",
  POINTS_PRESENT: "Tagihan ini menghasilkan poin loyalti. Poin harus disesuaikan manual dulu; sistem tidak menebak.",
  PERIOD_LOCKED: "Periode akuntansi sudah ditutup, koreksi tidak boleh dilakukan.",
  AVERAGE_UNSUPPORTED: "Metode persediaan rata-rata belum didukung untuk tarik baris.",
  IDEMPOTENCY_CONFLICT: "Permintaan dengan kunci yang sama sudah dipakai untuk koreksi lain. Muat ulang halaman.",
  STOCK_SHORT: "Stok tidak mencukupi.",
};

export function pesanTarikBaris(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim();
  const code = /^([A-Z_]{4,40}):/.exec(text)?.[1];
  if (code && PESAN[code]) {
    const detail = text.slice(code.length + 1).trim();
    return detail && ["COST_MISMATCH", "STOCK_MISMATCH", "PERIOD_LOCKED", "PARTIAL_NOT_ALLOWED"].includes(code) ? `${PESAN[code]} (${detail})` : PESAN[code];
  }
  if (/lock timeout|55P03|40P01|deadlock/i.test(text)) return "Tagihan sedang dipakai kasir lain. Tunggu sebentar lalu coba lagi.";
  if (/permission denied|42501/i.test(text)) return PESAN.ACCESS_DENIED;
  return "Koreksi belum terkonfirmasi. Periksa tagihan sebelum mencoba lagi; tidak ada yang diulang otomatis.";
}

export type BarisTarik = {
  invoice_item_id: string; deskripsi: string; qty: number; harga: number; hpp: number; eligible: boolean; message: string | null;
  quote: Pratinjau | null;
};
export type Pratinjau = {
  invoice_no: string; total_before: number; total_after: number; removed_total: number; hpp_removed: number;
  stock: { name: string; qty: number; cost: number }[];
  journals: { source: string; amount: number }[];
  advance: { no_uang_muka: string | null; balance_before: number; balance_after: number };
};

const LABEL_JURNAL: Record<string, string> = {
  "klinik-edit": "Pendapatan dikurangi (Dr 510002 / Cr 150001)",
  "klinik-hpp-edit": "HPP dibalik ke persediaan (Dr 170001 / Cr 600001)",
  "klinik-ar": "Pemakaian uang muka dikurangi, menjadi saldo pasien (Dr 150001 / Cr 314001)",
};
export const labelJurnal = (source: string) => LABEL_JURNAL[source] ?? source;
