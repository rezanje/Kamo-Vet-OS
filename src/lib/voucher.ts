// Kode voucher — aturan tunggal untuk layar pengelola (/crm/voucher) dan kasir.
// Pola sengaja mengikuti lib/promo.ts supaya "aktif hari ini" dibaca sama di
// kedua fitur; yang membedakan cuma voucher tidak dibatasi per cabang.

export type VoucherRow = {
  code: string;
  tipe: string;          // 'nominal' | 'persen'
  nilai: number;
  is_active: boolean;
  valid_from: string | null;   // 'YYYY-MM-DD', null = tanpa batas awal
  valid_until: string | null;  // 'YYYY-MM-DD', null = tanpa batas akhir
  max_potongan: number | null; // plafon rupiah; null = tanpa batas
  min_belanja: number;         // 0 = bebas
  boleh_gabung_promo: boolean;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Kode diketik kasir dengan huruf & spasi seadanya — disamakan di satu tempat
// supaya "hemat10", "HEMAT10 ", dan "hemat 10" menemukan baris yang sama.
export function normalizeKode(raw: unknown): string {
  return String(raw ?? "").toUpperCase().replace(/\s+/g, "").slice(0, 24);
}

export function voucherBerlaku(v: VoucherRow, today: string): boolean {
  if (!v.is_active) return false;
  if (v.valid_from && today < v.valid_from) return false;
  if (v.valid_until && today > v.valid_until) return false;
  return true;
}

export function voucherStatus(v: VoucherRow, today: string): "aktif" | "terjadwal" | "kadaluarsa" | "nonaktif" {
  if (!v.is_active) return "nonaktif";
  if (v.valid_until && v.valid_until < today) return "kadaluarsa";
  if (v.valid_from && v.valid_from > today) return "terjadwal";
  return "aktif";
}

/** Bagian voucher yang dipakai menghitung potongan. */
export type BatasVoucher = Pick<VoucherRow, "tipe" | "nilai" | "max_potongan">;

/**
 * Potongan dihitung dari nilai SETELAH diskon item (urutan §6). Tiga pagar:
 * - tidak melebihi tagihan — voucher nominal besar di transaksi kecil bikin total
 *   minus dan jurnalnya ikut salah;
 * - persen dipagari 100%;
 * - plafon `max_potongan` — ini yang menahan voucher persen di transaksi besar.
 */
export function potonganVoucher(dasar: number, v: BatasVoucher): number {
  const d = Number(dasar);
  const n = Number(v.nilai);
  if (!Number.isFinite(d) || d <= 0) return 0;
  if (!Number.isFinite(n) || n <= 0) return 0;

  const kasar = v.tipe === "persen" ? Math.round((d * Math.min(n, 100)) / 100) : n;

  const plafon = Number(v.max_potongan);
  const berplafon = Number.isFinite(plafon) && plafon > 0 ? Math.min(kasar, plafon) : kasar;

  return Math.min(d, Math.round(berplafon));
}

/** Keadaan keranjang yang ikut menentukan boleh-tidaknya voucher dipakai. */
export type KonteksVoucher = {
  /** Nilai belanja setelah diskon item — dasar yang sama dengan potongannya. */
  dasar: number;
  /** Keranjang sudah kena promo yang memotong otomatis. */
  adaPromoOtomatis: boolean;
};

// Pesan penolakan dibedakan supaya kasir tahu harus bilang apa ke pelanggan:
// "salah ketik" beda penanganannya dari "sudah lewat tanggalnya".
export function pesanVoucherDitolak(
  v: VoucherRow | null,
  today: string,
  konteks?: KonteksVoucher,
): string | null {
  if (!v) return "Kode voucher tidak ditemukan";

  const st = voucherStatus(v, today);
  if (st === "kadaluarsa") return `Voucher ${v.code} sudah kedaluwarsa (${v.valid_until})`;
  if (st === "terjadwal") return `Voucher ${v.code} baru berlaku mulai ${v.valid_from}`;
  if (st === "nonaktif") return `Voucher ${v.code} sedang dinonaktifkan`;

  if (!konteks) return null;

  const min = Number(v.min_belanja) || 0;
  if (min > 0 && konteks.dasar < min) {
    return `Voucher ${v.code} butuh belanja minimal ${rp(min)} (sekarang ${rp(konteks.dasar)})`;
  }

  // Promo otomatis yang menang: potongannya sudah muncul di layar sebelum kasir
  // mengetik voucher. Membatalkan promo di detik terakhir mengubah angka di depan
  // pelanggan — itu yang bikin ribut di kasir, bukan voucher yang ditolak.
  if (!v.boleh_gabung_promo && konteks.adaPromoOtomatis) {
    return `Voucher ${v.code} tidak bisa digabung dengan promo yang sedang berjalan`;
  }

  return null;
}

/** Ringkasan syarat voucher untuk layar pengelola. */
export function ringkasSyarat(v: VoucherRow): string {
  const bagian: string[] = [];
  if (v.max_potongan) bagian.push(`maks ${rp(v.max_potongan)}`);
  if (v.min_belanja > 0) bagian.push(`min belanja ${rp(v.min_belanja)}`);
  if (!v.boleh_gabung_promo) bagian.push("tidak digabung promo");
  return bagian.length ? bagian.join(" · ") : "tanpa syarat tambahan";
}
