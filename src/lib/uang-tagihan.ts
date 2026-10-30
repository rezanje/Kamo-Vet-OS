// Uang yang BENAR-BENAR diterima atas sebuah tagihan klinik — satu aturan, satu tempat.
//
// Ada DUA cara uang tagihan klinik tercatat, dan keduanya masih dipakai hari ini:
//
//   1. Checkout biasa dan checkout rombongan yang langsung lunas di meja. Baris
//      invoice-nya menyimpan `dp_amount` = 0, `paid_status` = "Lunas", dan TIDAK
//      punya satu pun baris `invoice_payments`; kasnya masuk lewat jurnal penjualan
//      klinik. Membaca "dibayar" sebagai dp_amount + invoice_payments untuk bentuk
//      ini menghasilkan NOL — tagihan lunas tercetak seolah masih berutang penuh.
//
//   2. Uang muka (DP), pembayaran campuran, tagihan tahap rawat inap, pelunasan
//      susulan lewat piutang, pembatalan kwitansi, dan pelepasan uang muka. Semua
//      uangnya ada di `invoice_payments` (termasuk baris NEGATIF pembalik), dan
//      `dp_amount` menyimpan uang muka yang diterima di kepala tagihan.
//
// Tagihan pengganti hasil terbit ulang selalu `dp_amount` = 0 dan membawa uang
// lamanya sebagai baris `invoice_payments` hasil salinan, jadi uangnya tidak boleh
// dihitung dua kali lewat kepala tagihan.
//
// Aturan ini sama persis dengan yang dipakai database saat menerbitkan ulang
// tagihan (clinic_void_reissue_invoice_core menghitung `v_direct`), supaya layar
// dan dokumen tidak pernah menyebut angka yang berbeda dari jurnalnya.

export type TagihanUang = {
  total: number;
  dp_amount: number;
  paid_status: string;
  reissued_from?: string | null;
};

/** Pembayaran yang tercatat untuk satu tagihan: jumlah bersih DAN ada/tidaknya baris. */
export type BayarTagihan = { jumlah: number; baris: number };

/**
 * Uang yang masuk di kepala tagihan — bukan dari baris pembayaran.
 *
 * Nol untuk tagihan pengganti (uangnya sudah pindah jadi baris pembayaran), dan
 * seluruh total untuk bentuk lama "lunas di meja tanpa baris pembayaran".
 * `paid_status` saja tidak pernah cukup: tagihan tahap yang kwitansinya dibatalkan
 * punya baris pembayaran yang saling meniadakan, dan di situ yang berlaku adalah
 * jumlah barisnya, bukan statusnya.
 */
export function uangKepalaTagihan(invoice: TagihanUang, bayar: BayarTagihan): number {
  if (invoice.reissued_from) return 0;
  if (invoice.paid_status === "Lunas" && bayar.baris === 0) return Number(invoice.total) || 0;
  return Number(invoice.dp_amount) || 0;
}

/** Total uang yang sudah diterima atas satu tagihan (tidak pernah negatif). */
export function uangDiterimaTagihan(invoice: TagihanUang, bayar: BayarTagihan): number {
  return Math.max(0, uangKepalaTagihan(invoice, bayar) + (Number(bayar.jumlah) || 0));
}

/** Sisa yang masih harus ditagih atas satu tagihan. */
export function sisaTagihan(invoice: TagihanUang, bayar: BayarTagihan): number {
  return Math.max(0, (Number(invoice.total) || 0) - uangDiterimaTagihan(invoice, bayar));
}

/** Kelompokkan baris pembayaran per tagihan: jumlah bersih dan cacah barisnya. */
export function bayarPerTagihan(
  rows: readonly { invoice_id: string; amount: number }[],
): Map<string, BayarTagihan> {
  const out = new Map<string, BayarTagihan>();
  for (const row of rows) {
    const kini = out.get(row.invoice_id) ?? { jumlah: 0, baris: 0 };
    out.set(row.invoice_id, { jumlah: kini.jumlah + (Number(row.amount) || 0), baris: kini.baris + 1 });
  }
  return out;
}

export const TANPA_BAYAR: BayarTagihan = { jumlah: 0, baris: 0 };

/** Status bayar yang ditampilkan, dihitung dari uang — bukan disalin dari kolomnya. */
export function statusUangTagihan(totalTagihan: number, dibayar: number): string {
  if (totalTagihan <= 0 || dibayar >= totalTagihan) return "Lunas";
  return dibayar > 0 ? "DP" : "Belum Lunas";
}

/**
 * Peran yang boleh membatalkan + menerbitkan ulang tagihan, dan mengoreksi tagihan
 * yang sudah menyangkut uang. Sama persis dengan penjaga di database
 * (clinic_void_reissue_invoice / clinic_edit_invoice); layar hanya menyembunyikan
 * tombolnya supaya staf tidak menabrak penolakan, bukan sebagai penjaga utama.
 */
export const PERAN_SIKLUS_TAGIHAN = ["OWNER", "ADMIN", "FINANCE"] as const;

export function bolehSiklusTagihan(role: string | null | undefined): boolean {
  return !!role && (PERAN_SIKLUS_TAGIHAN as readonly string[]).includes(role);
}
