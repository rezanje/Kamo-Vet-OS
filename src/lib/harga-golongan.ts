// Diskon golongan pelanggan (customer_categories.diskon_persen), migrasi 0066.
// Dipakai KLIEN untuk menampilkan dan SERVER sebagai satu-satunya sumber angka
// yang disimpan — kasir tidak boleh bisa mengarang diskon golongan.
//
// Persen sengaja di-cap di sini, bukan hanya di constraint DB: data lama atau
// data yang masuk lewat jalur lain tidak boleh bikin total transaksi negatif.
export function diskonGolongan(subtotal: number, persen: number): number {
  const sub = Number(subtotal);
  const p = Number(persen);
  if (!Number.isFinite(sub) || sub <= 0) return 0;
  if (!Number.isFinite(p) || p <= 0) return 0;
  const capPersen = Math.min(p, 100);
  return Math.min(sub, Math.round((sub * capPersen) / 100));
}

// Poin yang didapat dari satu transaksi (customer_categories.rupiah_per_poin,
// migrasi 0078). Golongan tanpa pengaturan sendiri memakai 1000 = perilaku lama.
//
// Angkanya dibulatkan ke bawah: memberi poin untuk belanja yang belum genap
// membuat saldo poin tidak pernah cocok dengan riwayat belanjanya.
export const RUPIAH_PER_POIN_DEFAULT = 1000;

export function poinDidapat(total: number, rupiahPerPoin?: number | null): number {
  const t = Number(total);
  if (!Number.isFinite(t) || t <= 0) return 0;
  const per = Number(rupiahPerPoin);
  const rate = Number.isFinite(per) && per > 0 ? per : RUPIAH_PER_POIN_DEFAULT;
  return Math.floor(t / rate);
}

// ── Pengecualian diskon per produk / kategori produk (migrasi 0082) ─────────
//
// Satu golongan bisa punya diskon berbeda untuk barang tertentu — margin pakan
// tidak sama dengan margin obat. Urutan menang, dari paling khusus:
//
//   1. aturan untuk PRODUK itu
//   2. aturan untuk KATEGORI produknya
//   3. aturan untuk KATEGORI INDUK-nya (kategori bertingkat 2, migrasi 0066)
//   4. diskon dasar golongan (customer_categories.diskon_persen)
//
// Tanpa satu pun pengecualian, hasilnya persis perilaku lama.

export type AturanDiskon = {
  item_id: string | null;
  item_category_id: string | null;
  diskon_persen: number;
};

export type BarangDiskon = {
  item_id: string;
  category_id: string | null;
  parent_category_id: string | null;
};

export function persenUntukBarang(
  aturan: AturanDiskon[],
  barang: BarangDiskon,
  persenDasar: number,
): number {
  const perProduk = aturan.find((a) => a.item_id && a.item_id === barang.item_id);
  if (perProduk) return Number(perProduk.diskon_persen);

  if (barang.category_id) {
    const perKategori = aturan.find((a) => a.item_category_id === barang.category_id);
    if (perKategori) return Number(perKategori.diskon_persen);
  }
  if (barang.parent_category_id) {
    const perInduk = aturan.find((a) => a.item_category_id === barang.parent_category_id);
    if (perInduk) return Number(perInduk.diskon_persen);
  }
  return Number(persenDasar) || 0;
}

// Diskon golongan untuk seluruh keranjang, dihitung PER BARIS.
//
// Dulu dihitung sekali dari subtotal. Begitu tiap barang bisa punya persen
// sendiri, penjumlahan per baris jadi satu-satunya cara yang benar — dan
// pembulatannya pun jadi lebih jujur karena mengikuti nilai tiap baris.
export function diskonGolonganKeranjang(
  baris: { item_id: string; qty: number; harga: number }[],
  aturan: AturanDiskon[],
  persenDasar: number,
  infoBarang: Map<string, BarangDiskon>,
): number {
  return baris.reduce((total, l) => {
    const info = infoBarang.get(l.item_id);
    const persen = info
      ? persenUntukBarang(aturan, info, persenDasar)
      : Number(persenDasar) || 0;
    return total + diskonGolongan((Number(l.qty) || 0) * (Number(l.harga) || 0), persen);
  }, 0);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// Pengecualian milik satu golongan. Dipakai server (angka yang disimpan) dan
// halaman kasir (angka yang ditampilkan) — keduanya harus baca sumber yang sama.
export async function loadAturanDiskon(
  supabase: AnyClient,
  customerCategoryId: string | null | undefined,
): Promise<AturanDiskon[]> {
  if (!customerCategoryId) return [];
  const { data } = await supabase
    .from("category_discounts")
    .select("item_id, item_category_id, diskon_persen")
    .eq("customer_category_id", customerCategoryId);
  return ((data ?? []) as AturanDiskon[]).map((a) => ({ ...a, diskon_persen: Number(a.diskon_persen) }));
}

// Kategori + kategori induk tiap barang, bahan baku persenUntukBarang().
export async function loadInfoBarang(
  supabase: AnyClient,
  itemIds?: string[],
): Promise<Map<string, BarangDiskon>> {
  let q = supabase.from("items").select("id, category_id, item_categories(parent_id)");
  if (itemIds) {
    if (itemIds.length === 0) return new Map();
    q = q.in("id", itemIds);
  }
  const { data } = await q;

  type Row = {
    id: string; category_id: string | null;
    item_categories: { parent_id: string | null } | { parent_id: string | null }[] | null;
  };
  const map = new Map<string, BarangDiskon>();
  for (const r of (data ?? []) as Row[]) {
    const kat = Array.isArray(r.item_categories) ? r.item_categories[0] : r.item_categories;
    map.set(r.id, {
      item_id: r.id,
      category_id: r.category_id,
      parent_category_id: kat?.parent_id ?? null,
    });
  }
  return map;
}
