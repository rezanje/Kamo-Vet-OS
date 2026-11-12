/**
 * Ubah transaksi struk kasir petshop (RPC edit_posted_pos_sale, migrasi 20261116300000).
 *
 * Fungsi murni: menyusun isi struk baru dari struk lama (sumber kebenaran: database) + isian Owner/Finance.
 * - Baris lama membawa promo/klaim/pelaksana/komponen Grup apa adanya (keputusan 3A); qty, harga, satuan dan
 *   potongan baris boleh diubah. Komponen Grup ikut skala qty baru.
 * - Barang baru boleh Persediaan / Jasa / Non-Persediaan (bukan Grup).
 * - Header: diskon golongan dan potongan lain (voucher, poin, diskon total) diisi sebagai angka; poin dipakai tetap.
 * - Pembayaran: jumlah barang per metode + fee merchant per metode, dihitung dengan aturan kasir yang sama.
 * Database memeriksa ulang semua angka (trigger pembayaran, stok atomik, finalisasi).
 */
import { PosDecimal, posNetTotal, posSubtotal, roundPosMoney } from "@/lib/pos-money";
import { quotePosMerchantFees } from "@/lib/pos-merchant-fees";
import { poinDidapat } from "@/lib/harga-golongan";

export const METODE_UBAH = ["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"] as const;
export type MetodeUbah = typeof METODE_UBAH[number];

export type BarisLama = {
  id: string; item_id: string | null; nama: string; qty: number; harga: number; satuan: string | null; faktor: number;
  target_species: string | null; service_performers: unknown; item_discount_type: string | null; item_discount_value: number;
  promo_id: string | null; promo_discount: number; quantity_pool_claim: boolean; promo_claim_id: string | null;
  promo_sets: number; promo_syarat_units: number; promo_hasil_units: number; promo_floor_waiver: boolean;
  source_position: number | null;
  components?: KomponenLama[];
};
export type KomponenLama = {
  component_item_id: string; component_code: string | null; component_name: string; item_type: string;
  qty_per_group: number; unit: string; factor: number; total_base_qty: number; sort_order: number;
};
export type BarangKatalog = { id: string; nama: string; item_type: string; is_active: boolean; units: { unit: string; factor: number }[] };

/** Isian formulir (dikirim sebagai JSON). `asal` = id baris lama; tanpa `asal` = barang baru. */
export type BarisIsian = {
  asal?: string | null; item_id: string; qty: number; harga: number; satuan: string;
  diskon_tipe?: "nominal" | "percent" | null; diskon_nilai?: number; promo_diskon?: number;
};
export type BayarIsian = { method: string; amount: number; fee_percent?: number };
export type IsianUbah = { lines: BarisIsian[]; diskon_kategori: number; potongan_lain: number; payments: BayarIsian[] };

export type StrukLama = {
  customer_id: string | null; poin_digunakan: number; subtotal: number; discount: number; diskon_kategori: number;
  items: BarisLama[];
};

export type PayloadUbah = {
  header: {
    subtotal: number; discount: number; diskon_kategori: number; total: number; merchant_fee_total: number;
    metode_bayar: string; bayar: number; kembali: number; payment_plan: { method: string; amount: number; fee_percent?: number; fee_amount?: number }[];
    poin_earned: number; poin_digunakan: number;
  };
  lines: Record<string, unknown>[];
};

const angka = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
const sen = (value: number) => new PosDecimal(value).equals(new PosDecimal(value).toDecimalPlaces(2));

export function diskonBaris(line: { qty: number; harga: number; item_discount_type: string | null; item_discount_value: number; promo_discount: number }): number {
  const gross = new PosDecimal(line.qty).times(line.harga);
  const manual = line.item_discount_type === "percent"
    ? gross.times(line.item_discount_value || 0).div(100).toDecimalPlaces(0)
    : new PosDecimal(line.item_discount_value || 0);
  const raw = manual.gt(0) ? manual : new PosDecimal(line.promo_discount || 0);
  return PosDecimal.min(PosDecimal.max(raw, 0), gross).toNumber();
}

/** Potongan lain di struk lama = diskon header di luar potongan baris (voucher, poin, diskon total). */
export function potonganLainLama(struk: StrukLama): number {
  const baris = struk.items.reduce((sum, line) => sum.plus(diskonBaris(line)), new PosDecimal(0));
  return PosDecimal.max(0, new PosDecimal(struk.discount).minus(baris)).toDecimalPlaces(2).toNumber();
}

export function susunUbahStruk({ lama, isian, katalog, rupiahPerPoin }: {
  lama: StrukLama; isian: IsianUbah; katalog: Map<string, BarangKatalog>; rupiahPerPoin: number | null;
}): PayloadUbah {
  if (!Array.isArray(isian.lines) || isian.lines.length === 0) throw new Error("Isi minimal satu barang.");
  if (isian.lines.length > 300) throw new Error("Rincian barang terlalu banyak.");
  const lamaById = new Map(lama.items.map(line => [line.id, line]));
  const dipakai = new Set<string>();
  const lines = isian.lines.map((row, index) => {
    const qty = angka(row.qty), harga = angka(row.harga);
    if (!(qty > 0) || !(harga >= 0) || !sen(harga) || qty > 1e9 || harga > 1e12) throw new Error(`Jumlah atau harga baris ${index + 1} tidak valid.`);
    const asal = row.asal ? lamaById.get(row.asal) : undefined;
    if (row.asal && !asal) throw new Error(`Baris ${index + 1} bukan milik struk ini. Muat ulang halaman.`);
    if (asal) {
      if (dipakai.has(asal.id)) throw new Error(`Baris ${index + 1} terduplikasi.`);
      dipakai.add(asal.id);
    }
    const barang = katalog.get(row.item_id);
    if (!barang) throw new Error(`Barang baris ${index + 1} tidak ditemukan.`);
    if (asal && asal.item_id !== row.item_id) throw new Error(`Barang baris ${index + 1} tidak boleh diganti; hapus barisnya lalu tambah barang baru.`);
    if (!asal && (!barang.is_active || barang.item_type === "Grup")) throw new Error(`${barang.nama} tidak bisa ditambahkan dari sini.`);
    let satuan = row.satuan, faktor = 1;
    if (barang.item_type === "Grup") { satuan = asal?.satuan ?? satuan; faktor = 1; }
    else {
      const unit = barang.units.find(u => u.unit === row.satuan);
      if (!unit) throw new Error(`Satuan ${row.satuan} untuk ${barang.nama} tidak tersedia.`);
      faktor = Number(unit.factor);
    }
    const diskonTipe = row.diskon_tipe === "percent" ? "percent" : row.diskon_tipe === "nominal" ? "nominal" : null;
    const diskonNilai = diskonTipe ? angka(row.diskon_nilai ?? 0) : 0;
    if (!(diskonNilai >= 0) || (diskonTipe === "percent" && diskonNilai > 100)) throw new Error(`Diskon baris ${index + 1} tidak valid.`);
    const promoDiskon = asal ? angka(row.promo_diskon ?? asal.promo_discount ?? 0) : 0;
    if (!(promoDiskon >= 0) || !sen(promoDiskon)) throw new Error(`Diskon promo baris ${index + 1} tidak valid.`);
    const components = asal?.components?.length
      ? asal.components.map(c => ({ ...c, total_base_qty: new PosDecimal(qty).times(c.qty_per_group).times(c.factor).toNumber() }))
      : [];
    if (barang.item_type === "Grup" && components.length === 0) throw new Error(`Rincian paket ${barang.nama} tidak lengkap.`);
    return {
      item_id: row.item_id, nama: asal?.nama ?? barang.nama, qty, harga, satuan, faktor,
      target_species: asal?.target_species ?? "Universal",
      service_performers: asal?.service_performers ?? null,
      item_discount_type: diskonTipe, item_discount_value: diskonNilai,
      promo_id: asal?.promo_id ?? null, promo_discount: asal?.promo_id || asal?.promo_claim_id ? promoDiskon : 0,
      quantity_pool_claim: asal?.quantity_pool_claim ?? false, promo_claim_id: asal?.promo_claim_id ?? null,
      promo_sets: asal?.promo_sets ?? 0, promo_syarat_units: asal?.promo_syarat_units ?? 0,
      promo_hasil_units: asal?.promo_hasil_units ?? 0, promo_floor_waiver: asal?.promo_floor_waiver ?? false,
      components,
    };
  });

  const subtotal = roundPosMoney(posSubtotal(lines));
  const lineDiscount = lines.reduce((sum, line) => sum.plus(diskonBaris(line)), new PosDecimal(0)).toNumber();
  const diskonKategori = angka(isian.diskon_kategori), potonganLain = angka(isian.potongan_lain);
  if (!(diskonKategori >= 0) || !(potonganLain >= 0) || !sen(diskonKategori) || !sen(potonganLain)) throw new Error("Diskon tidak valid.");
  const afterLines = posNetTotal(subtotal, lineDiscount);
  if (new PosDecimal(diskonKategori).plus(potonganLain).gt(afterLines)) throw new Error("Diskon melebihi total barang.");
  const total = posNetTotal(afterLines, diskonKategori, potonganLain);
  const discount = posNetTotal(subtotal, total, diskonKategori);

  const payments = (isian.payments ?? []).filter(part => angka(part.amount) > 0);
  if (total > 0 && payments.length === 0) throw new Error("Isi minimal satu metode pembayaran.");
  for (const part of payments) {
    if (!METODE_UBAH.includes(part.method as MetodeUbah)) throw new Error(`Metode ${part.method} tidak dikenal.`);
    if (!sen(angka(part.amount))) throw new Error(`Jumlah ${part.method} maksimal dua desimal.`);
  }
  if (new Set(payments.map(part => part.method)).size !== payments.length) throw new Error("Metode pembayaran tidak boleh dobel.");
  const sum = payments.reduce((acc, part) => acc.plus(part.amount), new PosDecimal(0));
  if (!sum.equals(total)) throw new Error(`Jumlah pembayaran ${roundPosMoney(sum.toNumber())} harus sama dengan total ${total}.`);
  const method = payments.length > 1 ? "Split" : payments[0]?.method ?? "Tunai";
  const quote = quotePosMerchantFees({
    total, method,
    payments: method === "Split" ? payments.map(part => ({ method: part.method, amount: part.amount, feePercent: Number(part.fee_percent ?? 0) })) : [],
    feePercent: method === "Split" ? 0 : Number(payments[0]?.fee_percent ?? 0),
  });
  const plan = total === 0 ? [] : quote.parts;

  return {
    header: {
      subtotal, discount, diskon_kategori: diskonKategori, total: quote.total, merchant_fee_total: quote.feeTotal,
      metode_bayar: method, bayar: quote.total, kembali: 0, payment_plan: plan,
      poin_earned: lama.customer_id ? poinDidapat(total, rupiahPerPoin) : 0, poin_digunakan: lama.poin_digunakan,
    },
    lines,
  };
}

/** Alasan struk belum bisa diubah dari layar ini (database tetap memeriksa ulang semuanya). */
export function alasanTidakBisaUbah(s: { channel?: string | null; voided_at?: string | null; payments_finalized_at?: string | null; shift_id?: string | null },
  extra: { receiptCycle: boolean; returns: boolean }): string | null {
  if (s.voided_at) return "Struk ini sudah dibatalkan atau sudah diubah. Buka struk terbarunya.";
  if (s.channel) return "Ubah transaksi hanya untuk struk kasir petshop.";
  if (!s.payments_finalized_at) return "Pembayaran struk ini belum selesai.";
  if (!s.shift_id) return "Struk tanpa shift kasir belum bisa diubah dari sini.";
  if (extra.receiptCycle) return "Struk ini pernah dibatalkan penerimaannya; ubah transaksi belum tersedia untuk struk seperti ini.";
  if (extra.returns) return "Struk ini sudah punya retur. Batalkan returnya dulu sebelum mengubah struk.";
  return null;
}
