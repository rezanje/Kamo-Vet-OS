// Master Barang & Jasa — aturan yang tidak menyentuh database, biar bisa dites.
// Jenis barang menggantikan trik lama "kategori bernama Jasa" (migrasi 0065).

import { TINDAKAN_KATEGORI } from "./tindakan";

export const ITEM_TYPES = ["Persediaan", "Jasa", "Non-Persediaan"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_TYPE_HINT: Record<ItemType, string> = {
  Persediaan: "Punya stok — dihitung masuk/keluar per gudang.",
  Jasa: "Tindakan/layanan. Tidak punya stok.",
  "Non-Persediaan": "Dijual atau dipakai, tapi stoknya tidak dilacak.",
};

// Nilai dari form tidak boleh dipercaya: jenis karangan bikin aturan wajib-consent
// & pemotongan stok ikut salah. Default aman = Persediaan.
export function pickItemType(raw: unknown): ItemType {
  const v = String(raw ?? "").trim();
  return (ITEM_TYPES as readonly string[]).includes(v) ? (v as ItemType) : "Persediaan";
}

export type BarangDraft = {
  name: string;
  code: string;
  categoryId: string;
  itemType: ItemType;
  sellPrice: number;
  buyPrice: number;
  minStock: number;
  tindakanKategori: string;
};

// Satu pintu validasi master barang. Kembalikan pesan Indonesia, bukan error DB —
// `items.code` NOT NULL UNIQUE, jadi kode kosong dulu bocor sbg error Postgres mentah.
export function validasiBarang(d: BarangDraft): string | null {
  if (!d.name.trim()) return "Nama barang wajib diisi";
  if (!d.code.trim()) return "Kode barang wajib diisi";
  if (!d.categoryId) return "Kategori barang wajib dipilih";
  if (!Number.isFinite(d.sellPrice) || d.sellPrice < 0) return "Harga jual tidak valid";
  if (!Number.isFinite(d.buyPrice) || d.buyPrice < 0) return "Harga beli tidak valid";
  if (!Number.isFinite(d.minStock) || d.minStock < 0) return "Stok minimum tidak valid";
  if (d.itemType === "Jasa" && !(TINDAKAN_KATEGORI as readonly string[]).includes(d.tindakanKategori)) {
    return "Jasa wajib punya kategori tindakan";
  }
  return null;
}

// Error DB → bahasa manusia. Yang tidak dikenali dilewatkan apa adanya supaya
// masalah tak terduga tetap kelihatan, bukan ditelan jadi "terjadi kesalahan".
const UNIQUE_MSG: Record<string, string> = {
  items_code_key: "Kode barang itu sudah dipakai barang lain",
  brands_name_key: "Merek dengan nama itu sudah ada",
  units_nama_key: "Satuan dengan nama itu sudah ada",
  item_categories_name_key: "Kategori barang dengan nama itu sudah ada",
  supplier_categories_nama_key: "Kategori pemasok dengan nama itu sudah ada",
  asset_categories_nama_key: "Kategori aset dengan nama itu sudah ada",
  customer_categories_nama_key: "Golongan pelanggan dengan nama itu sudah ada",
  coa_accounts_code_key: "Kode akun itu sudah dipakai akun lain",
};

export function pesanSimpanGagal(raw: string): string {
  const m = raw.toLowerCase();
  for (const [key, msg] of Object.entries(UNIQUE_MSG)) {
    if (m.includes(key)) return msg;
  }
  // Pelanggaran RLS = policy tabel kurang, bukan salah pemakai (kejadian nyata:
  // item_categories cuma punya policy SELECT sampai migrasi 0067). Pesannya tetap
  // menyebut tabelnya supaya developer bisa langsung nyari, tapi tidak lagi
  // memuntahkan error Postgres mentah ke layar kasir.
  if (m.includes("row-level security")) {
    const tabel = raw.match(/table "([^"]+)"/)?.[1];
    return `Perubahan ditolak izin database${tabel ? ` (tabel ${tabel})` : ""} — hubungi developer`;
  }
  return raw;
}
