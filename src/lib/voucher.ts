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
};

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

// Potongan dihitung dari nilai SETELAH diskon item (urutan §6), dan tidak boleh
// melebihi tagihannya — voucher nominal besar di transaksi kecil kalau tidak
// dibatasi bikin total minus dan jurnalnya ikut salah.
export function potonganVoucher(dasar: number, tipe: string, nilai: number): number {
  const d = Number(dasar);
  const n = Number(nilai);
  if (!Number.isFinite(d) || d <= 0) return 0;
  if (!Number.isFinite(n) || n <= 0) return 0;
  const kasar = tipe === "persen" ? Math.round((d * Math.min(n, 100)) / 100) : n;
  return Math.min(d, Math.round(kasar));
}

// Pesan penolakan dibedakan supaya kasir tahu harus bilang apa ke pelanggan:
// "salah ketik" beda penanganannya dari "sudah lewat tanggalnya".
export function pesanVoucherDitolak(v: VoucherRow | null, today: string): string | null {
  if (!v) return "Kode voucher tidak ditemukan";
  const st = voucherStatus(v, today);
  if (st === "aktif") return null;
  if (st === "kadaluarsa") return `Voucher ${v.code} sudah kedaluwarsa (${v.valid_until})`;
  if (st === "terjadwal") return `Voucher ${v.code} baru berlaku mulai ${v.valid_from}`;
  return `Voucher ${v.code} sedang dinonaktifkan`;
}
