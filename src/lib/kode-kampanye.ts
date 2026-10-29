// Kode kampanye (C05): nama lain untuk voucher ATAU promo yang sudah ada.
//
// Kasir mengetik kodenya di kolom voucher yang sama. Kode yang terikat voucher
// memakai syarat & rumus voucher itu apa adanya; kode yang terikat promo membuat
// promo itu ikut dipotong di transaksi ini (juga promo yang tidak "potong
// otomatis"). Batas pemakaian dijaga database saat struk/invoice disimpan, jadi
// dua kasir yang bersamaan tidak bisa melewati batas.
import { normalizeKode } from "./voucher";
import type { PromoHitung } from "./promo-hitung";

export type KodeKampanye = {
  code: string;
  /** Kode voucher tujuan (salah satu dari voucher_code / promo_id terisi). */
  voucher_code: string | null;
  promo_id: string | null;
  is_active: boolean;
  max_uses?: number | null;
};

export type KodeTerbaca = {
  /** Kode yang diketik, sudah dinormalkan. */
  kode: string | null;
  kampanye: KodeKampanye | null;
  /** Voucher yang benar-benar dihitung (kode voucher langsung atau tujuan kampanye). */
  voucherCode: string | null;
  promoId: string | null;
};

export function bacaKode(raw: unknown, daftar: KodeKampanye[]): KodeTerbaca {
  const kode = normalizeKode(raw) || null;
  const kampanye = kode ? daftar.find((k) => k.code === kode) ?? null : null;
  if (!kampanye) return { kode, kampanye: null, voucherCode: kode, promoId: null };
  return { kode, kampanye, voucherCode: kampanye.voucher_code, promoId: kampanye.promo_id };
}

/** Promo milik kode kampanye ikut dipotong di transaksi ini saja. */
export function promoDenganKode(promos: PromoHitung[], promoId: string | null): PromoHitung[] {
  if (!promoId) return promos;
  return promos.map((p) => (p.id === promoId && !p.autoApply ? { ...p, autoApply: true } : p));
}

/**
 * Alasan kode kampanye ditolak sebelum syarat vouchernya diperiksa.
 * `promoTerpakai` = promo tujuan benar-benar memotong minimal satu baris.
 */
export function pesanKampanyeDitolak(k: KodeKampanye, promoTersedia: boolean, promoTerpakai: boolean): string | null {
  if (!k.is_active) return `Kode ${k.code} sedang dinonaktifkan`;
  if (k.promo_id) {
    if (!promoTersedia) return `Promo untuk kode ${k.code} tidak berlaku di cabang ini hari ini`;
    if (!promoTerpakai) return `Kode ${k.code} belum memberi potongan untuk barang di keranjang`;
  }
  return null;
}

/**
 * Pembayaran rombongan (C05): satu pemilik membayar beberapa hewan sekaligus pada satu
 * hari (WIB) = SATU kali pakai kode, sama seperti voucher di jalur itu. Semua nota yang
 * memuat kode menyimpan kunci ini; database menghitung pemakaian per kunci dan hanya
 * menerima kunci milik pemilik kunjungan itu untuk hari ini. null = tanpa pemilik,
 * kode kampanye tidak bisa dipakai di rombongan.
 */
export function kunciGrupKampanye(customerId: string | null | undefined, tanggalWib: string): string | null {
  return customerId && /^\d{4}-\d{2}-\d{2}$/.test(tanggalWib) ? `${customerId}:${tanggalWib}` : null;
}

/**
 * Nota rombongan mana yang memuat kode kampanye: hanya nota yang benar-benar mendapat
 * potongan dari kode itu (porsi voucher tujuan, atau potongan promo tujuan) — sama
 * seperti voucher_code yang hanya ditulis di nota yang kebagian potongan voucher.
 */
export function notaMemuatKampanye(k: KodeKampanye | null, potongan: { voucher: number; promoKode: number }): boolean {
  if (!k) return false;
  return k.voucher_code ? potongan.voucher > 0 : potongan.promoKode > 0;
}

/**
 * POS back-office menerima kode KAMPANYE saja (voucher biasa tetap lewat layar kasir).
 * Kode yang diketik tapi bukan kode kampanye aktif ditolak dengan pesan ini.
 */
export function pesanBukanKampanye(kode: string | null, kampanye: KodeKampanye | null): string | null {
  return kode && !kampanye ? `Kode ${kode} bukan kode kampanye. Voucher biasa dipakai lewat layar kasir.` : null;
}

/** Pesan database (batas pemakaian dll.) diteruskan apa adanya bila memang pesan kampanye. */
export function pesanGagalKampanye(message: string | null | undefined): string | null {
  if (!message) return null;
  const m = /KODE_KAMPANYE:\s*(.+)$/.exec(message);
  return m ? m[1].trim() : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type Baris = { code: string; voucher_id: string | null; promo_id: string | null; is_active: boolean; max_uses: number | null; vouchers: { code: string } | { code: string }[] | null };
const kolom = "code, voucher_id, promo_id, is_active, max_uses, vouchers(code)";

function keKode(r: Baris): KodeKampanye {
  const v = Array.isArray(r.vouchers) ? r.vouchers[0] : r.vouchers;
  return { code: r.code, voucher_code: v?.code ?? null, promo_id: r.promo_id, is_active: !!r.is_active, max_uses: r.max_uses };
}

/**
 * Satu kode, dibaca server saat bayar. null = bukan kode kampanye.
 * Gagal baca diperlakukan "bukan kode kampanye": kodenya lalu dicari sebagai voucher
 * biasa dan ditolak bila tidak ada — tidak pernah memberi potongan yang salah, dan
 * voucher biasa tetap jalan sebelum langkah database C05 diterapkan.
 */
export async function bacaKodeKampanye(supabase: AnyClient, kode: string | null): Promise<KodeKampanye | null> {
  if (!kode) return null;
  const { data, error } = await supabase.from("campaign_codes").select(kolom).eq("code", kode).maybeSingle();
  if (error || !data) return null;
  return keKode(data as Baris);
}

/** Semua kode aktif untuk layar kasir (hanya tampilan; server memeriksa ulang). */
export async function loadKodeKampanyeAktif(supabase: AnyClient): Promise<KodeKampanye[]> {
  const { data, error } = await supabase.from("campaign_codes").select(kolom).eq("is_active", true).order("code").limit(1000);
  if (error) return [];
  return ((data ?? []) as Baris[]).map(keKode);
}
