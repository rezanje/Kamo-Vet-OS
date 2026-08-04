// Rantai dokumen penjualan (migrasi 0098) — murni, dites di __tests__/penjualan-dokumen.test.ts
//
// Penawaran → Pesanan → Pengiriman → Faktur → Penerimaan.
// Yang dikunci di sini: penomoran, sisa qty tiap tahap, dan jurnalnya.

export const AKUN_PIUTANG = "1201";
export const AKUN_PENDAPATAN = "4101";
export const AKUN_PPN_KELUARAN = "2201";
export const AKUN_HPP = "5101";
export const AKUN_PERSEDIAAN = "1301";
export const AKUN_UANG_MUKA_JUAL = "2103";

export type PrefixDokumen = "SQ" | "SO" | "DO" | "FJ" | "RC" | "UJ";

/** Awalan sebelum digit urutan — dipakai juga untuk mencari nomor tertinggi bulan itu. */
export function prefixNoDokumen(prefix: PrefixDokumen, date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${prefix}.${y}.${m}.`;
}

export function formatNoDokumen(prefix: PrefixDokumen, date: Date, seq: number): string {
  return `${prefixNoDokumen(prefix, date)}${String(seq).padStart(5, "0")}`;
}

export type BarisPesanan = {
  id: string;
  qty: number;
  qtyKirim: number;
  qtyFaktur: number;
  harga: number;
};

/**
 * Sisa yang masih boleh dikirim per baris pesanan.
 * Pengiriman dibatasi qty pesanan — kelebihan kirim harus jadi pesanan baru,
 * bukan diselundupkan ke pesanan lama yang nilainya sudah disepakati pelanggan.
 */
export function sisaKirim(b: BarisPesanan): number {
  return Math.max(0, Number(b.qty) - Number(b.qtyKirim));
}

/**
 * Sisa yang masih boleh difakturkan.
 *
 * Dibatasi qty yang SUDAH DIKIRIM, bukan qty pesanan: menagih barang yang belum
 * keluar gudang berarti mengakui pendapatan atas barang yang masih milik kita.
 */
export function sisaFaktur(b: BarisPesanan): number {
  return Math.max(0, Number(b.qtyKirim) - Number(b.qtyFaktur));
}

/** Pesanan tuntas kalau semua barisnya sudah dikirim penuh dan difakturkan penuh. */
export function pesananSelesai(baris: BarisPesanan[]): boolean {
  return baris.length > 0 && baris.every((b) => sisaKirim(b) <= 0 && sisaFaktur(b) <= 0);
}

export type JurnalLine = { code: string; debit: number; credit: number };

/**
 * Pengiriman: barang keluar gudang, jadi modalnya diakui sekarang.
 * Pendapatan TIDAK diakui di sini — itu urusan faktur. Mengakui keduanya di dua
 * dokumen berbeda memang disengaja supaya barang yang sudah dikirim tapi belum
 * ditagih tetap kelihatan sebagai selisih.
 */
export function jurnalPengiriman(totalHpp: number): JurnalLine[] {
  const n = Math.round(Number(totalHpp) || 0);
  if (n <= 0) return [];
  return [
    { code: AKUN_HPP, debit: n, credit: 0 },
    { code: AKUN_PERSEDIAAN, debit: 0, credit: n },
  ];
}

/** Faktur: piutang lahir, pendapatan diakui, PPN keluaran dipisah kalau PKP. */
export function jurnalFakturJual(dpp: number, ppn: number): JurnalLine[] {
  const d = Math.round(Number(dpp) || 0);
  const p = Math.round(Number(ppn) || 0);
  const total = d + p;
  if (total <= 0) return [];

  const lines: JurnalLine[] = [
    { code: AKUN_PIUTANG, debit: total, credit: 0 },
    { code: AKUN_PENDAPATAN, debit: 0, credit: d },
  ];
  if (p > 0) lines.push({ code: AKUN_PPN_KELUARAN, debit: 0, credit: p });
  return lines;
}

/**
 * Penerimaan pelanggan. Porsi yang diambil dari uang muka tidak menambah kas —
 * uangnya sudah masuk waktu DP dibayar; mencatatnya lagi berarti uang yang sama
 * masuk dua kali.
 */
export function jurnalPenerimaan(kasCode: string, total: number, dariUangMuka: number): JurnalLine[] {
  const n = Math.round(Number(total) || 0);
  if (n <= 0) return [];
  const um = Math.min(Math.max(0, Math.round(Number(dariUangMuka) || 0)), n);
  const kas = n - um;

  const lines: JurnalLine[] = [];
  if (kas > 0) lines.push({ code: kasCode, debit: kas, credit: 0 });
  if (um > 0) lines.push({ code: AKUN_UANG_MUKA_JUAL, debit: um, credit: 0 });
  lines.push({ code: AKUN_PIUTANG, debit: 0, credit: n });
  return lines;
}

/** Uang muka dari pelanggan: kas bertambah, tapi itu utang jasa/barang, bukan pendapatan. */
export function jurnalUangMukaJual(kasCode: string, jumlah: number): JurnalLine[] {
  const n = Math.round(Number(jumlah) || 0);
  if (n <= 0) return [];
  return [
    { code: kasCode, debit: n, credit: 0 },
    { code: AKUN_UANG_MUKA_JUAL, debit: 0, credit: n },
  ];
}

/** Sisa tagihan faktur setelah seluruh penerimaan. */
export function sisaTagihan(total: number, penerimaan: { jumlah: number }[]): number {
  const dibayar = penerimaan.reduce((a, p) => a + Number(p.jumlah), 0);
  return Math.max(0, Math.round(Number(total) - dibayar));
}
