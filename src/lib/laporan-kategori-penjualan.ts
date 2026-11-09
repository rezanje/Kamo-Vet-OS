import { PosDecimal } from "./pos-money";

/** Kategori dan sub kategori untuk "Rincian penjualan per barang" (format mirip Accurate). Hanya baca, tidak mengubah angka. */
export type KategoriNode = { id: string; name: string; parent_id?: string | null };
export type ItemKategori = { code?: string | null; category_id?: string | null };
export type KategoriBaris = { kode: string; kategori: string; subKategori: string };

export const KATEGORI_RACIKAN = "RACIKAN";
export const KATEGORI_LAINNYA = "LAINNYA";
export const KATEGORI_TANPA = "TANPA KATEGORI";
const BATAS_KEDALAMAN = 20;

export function petaKategori(categories: readonly KategoriNode[]): ReadonlyMap<string, KategoriNode> {
  return new Map(categories.map(category => [category.id, category]));
}

const tanpa = { kategori: KATEGORI_TANPA, subKategori: "" };

/** Naik lewat parent_id sampai kategori induk. Induk = nama huruf besar; sub = anak langsung induk pada rantai itu. */
export function resolveKategori(categoryId: string | null | undefined, peta: ReadonlyMap<string, KategoriNode>): { kategori: string; subKategori: string } {
  if (!categoryId) return tanpa;
  const rantai: KategoriNode[] = [];
  const dilihat = new Set<string>();
  let id: string | null | undefined = categoryId;
  while (id) {
    if (dilihat.has(id) || rantai.length >= BATAS_KEDALAMAN) return tanpa; // rantai melingkar / data rusak
    dilihat.add(id);
    const node = peta.get(id);
    if (!node) break; // induk hilang: kategori teratas yang masih terbaca dipakai sebagai induk
    rantai.push(node);
    id = node.parent_id;
  }
  if (!rantai.length) return tanpa;
  const induk = rantai[rantai.length - 1];
  const sub = rantai.length >= 2 ? rantai[rantai.length - 2] : null;
  const nama = induk.name.trim().toLocaleUpperCase("id-ID");
  return { kategori: nama || KATEGORI_TANPA, subKategori: sub ? sub.name.trim() : "" };
}

/** Baris tanpa item tidak pernah dibuang: racikan -> RACIKAN, selain itu LAINNYA. Item tanpa kategori -> TANPA KATEGORI. */
export function klasifikasiBaris({ jenis, itemId, items, peta }: {
  jenis: string; itemId: string | null | undefined; items: ReadonlyMap<string, ItemKategori>; peta: ReadonlyMap<string, KategoriNode>;
}): KategoriBaris {
  const item = itemId ? items.get(itemId) : undefined;
  const kode = item?.code ?? "";
  if (jenis === "Racikan") return { kode, kategori: KATEGORI_RACIKAN, subKategori: "" };
  if (!itemId) return { kode: "", kategori: KATEGORI_LAINNYA, subKategori: "" };
  return { kode, ...resolveKategori(item?.category_id, peta) };
}

export function cocokKategori(row: { kategori: string }, pilihan: string): boolean {
  const dipilih = pilihan.trim();
  return !dipilih || row.kategori.toLocaleUpperCase("id-ID") === dipilih.toLocaleUpperCase("id-ID");
}

type BarisRingkas = { kategori: string; subKategori: string; qty: number; nilai: number; indukId?: string };
type Jumlah = { qty: number; nilai: number; baris: number };
export type RingkasanKategori = {
  groups: (Jumlah & { kategori: string; subs: (Jumlah & { subKategori: string })[] })[];
  totalQty: number; totalNilai: number; totalBaris: number;
};

/** Ringkasan memakai baris induk saja (baris anak BMHP bernilai nol dan tidak masuk total laporan). Penjumlahan desimal eksak. */
export function ringkasKategori(rows: readonly BarisRingkas[]): RingkasanKategori {
  type Akum = { qty: InstanceType<typeof PosDecimal>; nilai: InstanceType<typeof PosDecimal>; baris: number };
  const baru = (): Akum => ({ qty: new PosDecimal(0), nilai: new PosDecimal(0), baris: 0 });
  const tambah = (a: Akum, row: BarisRingkas) => { a.qty = a.qty.plus(row.qty); a.nilai = a.nilai.plus(row.nilai); a.baris += 1; };
  const jumlah = (a: Akum): Jumlah => ({ qty: a.qty.toNumber(), nilai: a.nilai.toNumber(), baris: a.baris });
  const total = baru();
  const peta = new Map<string, { akum: Akum; subs: Map<string, Akum> }>();
  for (const row of rows) {
    if (row.indukId) continue;
    tambah(total, row);
    if (!peta.has(row.kategori)) peta.set(row.kategori, { akum: baru(), subs: new Map() });
    const grup = peta.get(row.kategori)!;
    tambah(grup.akum, row);
    if (!grup.subs.has(row.subKategori)) grup.subs.set(row.subKategori, baru());
    tambah(grup.subs.get(row.subKategori)!, row);
  }
  const urut = (a: string, b: string) => a.localeCompare(b, "id");
  return {
    groups: [...peta.entries()].sort(([a], [b]) => urut(a, b)).map(([kategori, grup]) => ({
      kategori, ...jumlah(grup.akum),
      subs: [...grup.subs.entries()].sort(([a], [b]) => urut(a, b)).map(([subKategori, akum]) => ({ subKategori, ...jumlah(akum) })),
    })),
    totalQty: total.qty.toNumber(), totalNilai: total.nilai.toNumber(), totalBaris: total.baris,
  };
}

export const LABEL_TANPA_SUB = "(tanpa sub kategori)";
export type BarisTabelRingkasan = { tingkat: "kategori" | "sub"; kategori: string; subKategori: string; qty: number; nilai: number; baris: number };

/** Baris datar untuk layar dan unduhan: subtotal per kategori, lalu rincian sub kategori bila kategori itu punya sub. */
export function barisTabelRingkasan(ringkasan: RingkasanKategori): BarisTabelRingkasan[] {
  return ringkasan.groups.flatMap(grup => [
    { tingkat: "kategori" as const, kategori: grup.kategori, subKategori: "", qty: grup.qty, nilai: grup.nilai, baris: grup.baris },
    ...(grup.subs.some(sub => sub.subKategori !== "") ? grup.subs.map(sub => ({
      tingkat: "sub" as const, kategori: grup.kategori, subKategori: sub.subKategori || LABEL_TANPA_SUB, qty: sub.qty, nilai: sub.nilai, baris: sub.baris,
    })) : []),
  ]);
}

export const KOLOM_ACCURATE = ["Nomor #", "Cabang", "Tanggal", "Kode #", "Nama Barang", "Kategori", "Sub kategori", "Kuantitas", "@Harga", "Total Harga", "Pelanggan", "Diskon", "Nama Tenaga Penjual"] as const;

type BarisAccurate = {
  dokumen: string; cabang: string; waktu: string; kode: string; nama: string; kategori: string; subKategori: string;
  qty: number; harga: number; nilai: number; pelanggan: string; diskon: number; pelaksana: string;
};

/** Tanggal WIB (tengah malam UTC, supaya Excel menampilkan tanggal yang sama di zona waktu mana pun). */
function tanggalWib(waktu: string): Date {
  const hari = new Date(new Date(waktu).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  return new Date(`${hari}T00:00:00Z`);
}

export function barisAccurate(row: BarisAccurate): (string | number | Date)[] {
  return [row.dokumen, row.cabang, tanggalWib(row.waktu), row.kode, row.nama, row.kategori, row.subKategori,
    row.qty, row.harga, row.nilai, row.pelanggan === "—" ? "" : row.pelanggan, row.diskon, row.pelaksana === "—" ? "" : row.pelaksana];
}
