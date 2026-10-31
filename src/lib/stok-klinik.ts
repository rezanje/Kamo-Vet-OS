/**
 * Satu cara membaca dan menampilkan stok di semua jalur input klinik (Paket B):
 * form Rekam Medis, OBAT KHUSUS rawat inap, racikan susulan, dan Pembayaran.
 *
 * - Angkanya selalu stok GUDANG TRANSAKSI: gudang VET aktif tertua di cabang kunjungan,
 *   sama persis dengan gudang yang dipakai `clinic_post_invoice` saat stok benar-benar keluar
 *   (lihat `loadClinicSkuDetails`). Tidak pernah stok gudang/cabang lain.
 * - Stok di database tersimpan dalam satuan dasar. Untuk satuan jual lain dibagi faktornya;
 *   bila faktornya tidak diketahui, angka dasar TIDAK dipakai sebagai angka satuan jual.
 * - `null` = belum terbaca (gudang klinik cabang tidak ditemukan/terlihat). Ditampilkan
 *   "belum terbaca", tidak pernah sebagai 0, dan tidak dinilai kurang/cukup.
 *
 * Modul ini hanya tampilan: waktu posting stok/HPP/jurnal tidak berubah, dan database tetap
 * memeriksa stok saat tagihan disimpan.
 */
import { angkaTampil } from "./stok-kurang";

/** Stok satuan dasar di gudang transaksi; null = belum terbaca. */
export type StokDasar = number | null;

/** Hasil pembaca bersama untuk satu barang. */
export function stokGudangKlinik(details: { stock: Map<string, number>; warehouseId: string | null }, itemId: string): StokDasar {
  // Tanpa gudang klinik yang terbaca, tidak ada baris stok bukan berarti nol.
  if (!details.warehouseId) return null;
  return details.stock.get(itemId) ?? 0;
}

type SatuanFaktor = { unit: string; factor: number };
export type StokItemKlinik = { stok: StokDasar; unit: string; units?: SatuanFaktor[] };
export type PetaStokKlinik = Map<string, StokItemKlinik>;

/** Peta stok untuk tampilan dan pemeriksaan keranjang. Jasa tidak punya stok. */
export function petaStokKlinik(
  ...daftar: { id: string; stok: StokDasar; unit: string; item_type?: string; units?: SatuanFaktor[] }[][]
): PetaStokKlinik {
  const peta: PetaStokKlinik = new Map();
  for (const list of daftar) for (const it of list) {
    if (it.item_type === "Jasa" || peta.has(it.id)) continue;
    peta.set(it.id, { stok: it.stok ?? null, unit: it.unit, units: it.units });
  }
  return peta;
}

/** Faktor satuan ke satuan dasar; null bila satuannya tidak dikenal barang ini. */
export function faktorSatuanKlinik(item: { unit: string; units?: SatuanFaktor[] } | undefined, satuan: string | null | undefined): number | null {
  if (!item) return null;
  if (!satuan || satuan === item.unit) return 1;
  const f = Number(item.units?.find(u => u.unit === satuan)?.factor);
  return Number.isFinite(f) && f > 0 ? f : null;
}

export type StatusStok = "belum-terbaca" | "tanpa-konversi" | "habis" | "kurang" | "cukup";
export type KeadaanStok = {
  status: StatusStok;
  /** Dalam `satuan`; null bila belum terbaca atau tidak dapat dikonversi. */
  tersedia: number | null;
  satuan: string;
  stokDasar: StokDasar;
  satuanDasar: string;
  faktor: number | null;
  /** Kebutuhan baris dalam `satuan`. */
  butuh: number | null;
};

export function keadaanStok({ stok, satuanDasar, satuan, faktor, butuh }: {
  stok: StokDasar; satuanDasar: string; satuan?: string | null; faktor?: number | null; butuh?: number | null;
}): KeadaanStok {
  const unit = satuan || satuanDasar;
  const f = unit === satuanDasar ? 1 : faktor != null && Number.isFinite(Number(faktor)) && Number(faktor) > 0 ? Number(faktor) : null;
  const perlu = butuh != null && Number.isFinite(Number(butuh)) ? Number(butuh) : null;
  const dasar = stok == null || !Number.isFinite(Number(stok)) ? null : Number(stok);
  const hasil = { satuan: unit, stokDasar: dasar, satuanDasar, faktor: f, butuh: perlu };
  if (dasar == null) return { ...hasil, status: "belum-terbaca", tersedia: null };
  if (f == null) return { ...hasil, status: "tanpa-konversi", tersedia: null };
  // Pembulatan 6 angka: 25 / 10 tetap 2,5, bukan 2,4999999.
  const tersedia = Number((dasar / f).toFixed(6));
  const status: StatusStok = perlu != null && perlu > tersedia ? "kurang" : tersedia <= 0 ? "habis" : "cukup";
  return { ...hasil, status, tersedia };
}

export function teksStok(k: KeadaanStok): string {
  if (k.status === "belum-terbaca") return "stok belum terbaca";
  if (k.status === "tanpa-konversi") return `stok ${angkaTampil(k.stokDasar)} ${k.satuanDasar} (faktor ${k.satuan} belum ada)`;
  const dasar = k.faktor !== 1 ? ` (${angkaTampil(k.stokDasar)} ${k.satuanDasar})` : "";
  const kurang = k.status === "kurang" && k.butuh != null && k.tersedia != null
    ? ` · kurang ${angkaTampil(Number((k.butuh - k.tersedia).toFixed(6)))} ${k.satuan}` : "";
  return `stok ${angkaTampil(k.tersedia)} ${k.satuan}${dasar}${kurang}`;
}

/** Ringkas untuk label pilihan: "Nama (stok 5 pcs)" / "Nama (stok belum terbaca)". */
export function labelStok(item: { name: string; stok: StokDasar; unit: string }): string {
  return `${item.name} (${teksStok(keadaanStok({ stok: item.stok, satuanDasar: item.unit }))})`;
}
