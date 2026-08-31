// Logika murni Retur Pembelian/Penjualan — dites di __tests__/retur.test.ts

// Nomor dokumen: RB.YYYY.MM.NNNNN (beli) / RJ.YYYY.MM.NNNNN (jual), seq per bulan.
export function formatNoRetur(jenis: "RB" | "RJ", date: Date, seq: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${jenis}.${y}.${m}.${String(seq).padStart(5, "0")}`;
}

// Sisa qty yang masih boleh diretur per item = qty sumber − akumulasi retur sebelumnya.
export function sisaRetur(
  sumber: Record<string, number>,
  sudahRetur: Record<string, number>,
): Record<string, number> {
  const sisa: Record<string, number> = {};
  for (const [itemId, qty] of Object.entries(sumber)) {
    const rem = qty - (sudahRetur[itemId] ?? 0);
    if (rem > 0) sisa[itemId] = rem;
  }
  return sisa;
}

// Total nilai retur = Σ qty × harga.
export function totalRetur(rows: { qty: number; harga: number }[]): number {
  return rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.harga) || 0), 0);
}

/**
 * Membagi qty dasar dan HPP snapshot satu baris Grup menurut qty induk yang
 * diretur. Snapshot sudah mewakili seluruh qty baris penjualan, jadi rasio harus
 * memakai qty Grup pada sale_item asal—bukan resep master saat ini.
 */
export function alokasiReturGrup(
  qtyRetur: number,
  qtyTerjual: number,
  snapshots: { component_item_id: string | null; total_base_qty: number; hpp: number }[],
) {
  const retur = Number(qtyRetur);
  const terjual = Number(qtyTerjual);
  if (!Number.isFinite(retur) || retur < 0 || !Number.isFinite(terjual) || terjual <= 0) {
    throw new Error("Qty retur Grup tidak valid");
  }
  if (retur > terjual) throw new Error("Qty retur Grup melebihi qty terjual");
  const ratio = retur / terjual;
  return snapshots.map((snapshot) => ({
    component_item_id: snapshot.component_item_id,
    qty: Number(snapshot.total_base_qty) * ratio,
    hpp: Number(snapshot.hpp) * ratio,
  }));
}

// ── Refund harus sebanding dengan yang BENAR-BENAR dibayar ─────────────────
//
// Struk POS bisa kena promo, diskon golongan, voucher, dan poin. Kalau refund
// memakai harga daftar, pelanggan yang belanja banyak pakai diskon lalu meretur
// semuanya akan menerima uang LEBIH BANYAK daripada yang ia keluarkan.
//
// Rasio dihitung dari total dibayar ÷ nilai kotor struk, lalu dipakai ke tiap
// baris. Sederhana, dan tidak pernah mengembalikan lebih dari yang masuk.
export function rasioBayar(subtotalKotor: number, totalDibayar: number): number {
  const kotor = Number(subtotalKotor);
  const bayar = Number(totalDibayar);
  if (!Number.isFinite(kotor) || kotor <= 0) return 1;
  if (!Number.isFinite(bayar) || bayar < 0) return 1;
  // Rasio > 1 tidak masuk akal (bayar lebih besar dari harga daftar) — jangan
  // sampai refund justru membengkak karena data aneh.
  return Math.min(1, bayar / kotor);
}

export function hargaRefund(hargaSatuan: number, rasio: number): number {
  const h = Number(hargaSatuan);
  if (!Number.isFinite(h) || h <= 0) return 0;
  return Math.round(h * rasio);
}

// Modal per satuan barang yang diretur. Pakai HPP yang tercatat saat barang itu
// TERJUAL (sale_items.hpp, migrasi 0084) supaya nilai persediaan yang masuk
// kembali sama persis dengan yang keluar.
//
// Struk lama belum punya kolom itu → jatuh ke harga beli master, perilaku lama.
export function modalPerSatuan(
  hppBaris: number | null | undefined,
  qtyBaris: number,
  buyPriceMaster: number,
): number {
  const hpp = Number(hppBaris);
  const qty = Number(qtyBaris);
  if (Number.isFinite(hpp) && hpp > 0 && Number.isFinite(qty) && qty > 0) return hpp / qty;
  return Number(buyPriceMaster) || 0;
}

/**
 * Modal per satuan untuk SEMUA baris struk, dijumlahkan dulu per barang.
 *
 * Satu barang bisa muncul beberapa kali dalam satu struk — sejak satuan berjenjang
 * ada, "1 box + 3 pcs" barang yang sama itu dua baris. Kalau tiap baris dihitung
 * sendiri lalu saling menimpa, modal yang dipakai adalah modal baris TERAKHIR
 * dibagi qty baris itu saja; retur box yang modalnya dihitung dari 3 pcs bisa
 * meleset berkali-kali lipat.
 *
 * Dijumlahkan lebih dulu (total modal ÷ total qty dasar) supaya hasilnya modal
 * rata-rata tertimbang yang benar berapa pun cara barangnya dipecah.
 */
export function modalPerBarang(
  baris: { item_id: string | null; qtyDasar: number; hpp?: number | null }[],
): Record<string, number> {
  const akum = new Map<string, { hpp: number; qty: number }>();
  for (const b of baris) {
    if (!b.item_id) continue;
    const qty = Number(b.qtyDasar) || 0;
    if (qty <= 0) continue;
    const cur = akum.get(b.item_id) ?? { hpp: 0, qty: 0 };
    cur.hpp += Number(b.hpp) || 0;
    cur.qty += qty;
    akum.set(b.item_id, cur);
  }
  const out: Record<string, number> = {};
  for (const [id, v] of akum) out[id] = modalPerSatuan(v.hpp, v.qty, 0);
  return out;
}

export type KondisiRetur = "baik" | "rusak";

/**
 * Sifat barang yang dibutuhkan layar retur: punya stok atau tidak, dan apakah
 * kadaluarsanya dipantau. Dipakai dua layar (backoffice & kasir) supaya
 * dropdown kondisi tidak muncul untuk jasa, dan isian tanggal kadaluarsa hanya
 * muncul untuk barang yang memang dipantau.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function infoBarangRetur(supabase: any, itemIds: string[]) {
  const ids = [...new Set(itemIds.filter(Boolean))];
  const peta = new Map<string, { berstok: boolean; trackExpiry: boolean }>();
  if (ids.length === 0) return peta;
  const { data } = await supabase
    .from("items").select("id, item_type, track_expiry").in("id", ids);
  for (const r of (data ?? []) as { id: string; item_type: string | null; track_expiry: boolean | null }[]) {
    peta.set(r.id, {
      berstok: (r.item_type ?? "Persediaan") === "Persediaan",
      trackExpiry: !!r.track_expiry,
    });
  }
  return peta;
}

/** Hanya barang berkondisi "baik" yang boleh masuk kembali ke stok jualan. */
export function bolehMasukStok(kondisi: string | null | undefined): boolean {
  return (kondisi ?? "baik").toLowerCase() !== "rusak";
}

/**
 * Modal barang yang kembali, dipecah menurut nasibnya.
 *
 * - `baik`  → nilainya masuk lagi ke Persediaan (1301)
 * - `rusak` → barangnya tidak bisa dijual lagi, nilainya jadi kerugian (5902),
 *   bukan menambah persediaan
 *
 * Dua-duanya sama-sama membalik HPP (5101), karena beban pokok penjualan hanya
 * boleh menempel pada barang yang benar-benar terjual dan tidak kembali.
 */
export function pisahModalRetur(
  rows: { item_id: string; qty: number; kondisi?: string | null }[],
  modalSatuan: (itemId: string) => number,
  berstok: (itemId: string) => boolean,
): { baik: number; rusak: number; total: number } {
  let baik = 0;
  let rusak = 0;
  for (const r of rows) {
    if (!berstok(r.item_id)) continue; // jasa tidak punya modal persediaan
    const nilai = modalSatuan(r.item_id) * (Number(r.qty) || 0);
    if (nilai <= 0) continue;
    if (bolehMasukStok(r.kondisi)) baik += nilai;
    else rusak += nilai;
  }
  return { baik, rusak, total: baik + rusak };
}
