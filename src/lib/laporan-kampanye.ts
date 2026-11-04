// Laporan Promo — bagian "Kampanye / kode kampanye" (C05).
//
// Definisi "satu pemakaian" sama persis dengan database (campaign_code_used, migrasi
// 20261028181000): struk POS yang pembayarannya sudah final dan tidak batal + invoice klinik
// yang tidak batal, yang membawa kodenya. Rentang tanggal memakai created_at dengan batas
// yang sama dengan query halaman (gte mulai, lte akhir). Terbit ulang invoice klinik:
// invoice asli batal, salinan baru mewarisi kode — jadi satu pemakaian, tidak dobel.
import { lineDiscount } from "./pos-calc";
import { isCompletedSale, type SaleCompletion } from "./sale-payment-reporting";
import { completeReportQuery } from "./report-query";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

export type KampanyeKode = {
  id: string; code: string; voucher_id: string | null; promo_id: string | null;
  max_uses: number | null; is_active: boolean; note: string | null;
};
export type KampanyeSaleItem = {
  qty: number; harga: number; item_discount_type: string | null; item_discount_value: number | null;
  promo_id: string | null; promo_discount: number | null;
};
export type KampanyeSale = SaleCompletion & {
  id: string; total: number; discount: number; diskon_kategori: number | null; poin_digunakan: number | null;
  created_at: string; branches: Rel<{ name: string }>; campaign_code: string | null;
  sale_items: KampanyeSaleItem[] | null;
};
export type KampanyeInvoice = {
  id: string; total: number; discount: number; created_at: string; voided_at: string | null;
  campaign_code: string | null;
  visits: Rel<{ branch_id: string | null; branches: Rel<{ name: string }> }>;
};

export type KampanyeInput = {
  kode: KampanyeKode[];
  vouchers: { id: string; code: string; valid_until: string | null }[];
  promos: { id: string; name: string; valid_until: string | null }[];
  sales: KampanyeSale[];
  invoices: KampanyeInvoice[];
  /** Batas rentang persis seperti query halaman: `${dari}T00:00:00+07:00`. */
  mulai: string;
  akhir: string;
  /** Tanggal WIB hari ini (YYYY-MM-DD), untuk status kadaluarsa. */
  hariIni: string;
};

export type KampanyeRow = {
  id: string | null;
  code: string;
  jenis: "voucher" | "promo" | null;
  tujuan: string;
  status: "aktif" | "nonaktif" | "kadaluarsa" | "dihapus";
  maxUses: number | null;
  /** Pemakaian seumur hidup (dasar kuota) — bukan hanya di rentang. */
  terpakaiSemua: number;
  /** Sisa kuota seumur hidup; null = tanpa batas. */
  sisa: number | null;
  pakai: number; pakaiPos: number; pakaiKlinik: number;
  /** Dokumen di rentang yang membawa kode tapi tidak dihitung (batal / belum final). */
  tidakDihitung: number;
  omzetPos: number; omzetKlinik: number; omzet: number;
  /**
   * Potongan yang bisa dipastikan. Hanya kode terikat promo: potongan POS = promo_discount baris
   * promo tujuan (angka yang sama dengan tabel promo otomatis). `pos: null` = tidak bisa dipisah.
   * `eksak: false` = ada bagian yang tidak bisa dipastikan (voucher menyatu dengan diskon manual;
   * invoice klinik tidak menyimpan potongan per promo).
   */
  potongan: { pos: number | null; eksak: boolean };
  /** Total diskon seluruh dokumen yang dihitung (batas atas, rumus tabel diskon cabang). */
  diskonDokumen: number;
  cabang: { nama: string; n: number }[];
  note: string | null;
};

/** Rumus potongan per struk — sama dengan tabel "Diskon per cabang". */
export function diskonSale(s: Pick<KampanyeSale, "discount" | "diskon_kategori" | "poin_digunakan" | "sale_items">) {
  const item = (s.sale_items ?? []).reduce((a, l) => a + lineDiscount({
    qty: Number(l.qty) || 0, harga: Number(l.harga) || 0,
    item_discount_type: (l.item_discount_type as "nominal" | "percent" | null) ?? null,
    item_discount_value: Number(l.item_discount_value) || 0,
    promo_discount: Number(l.promo_discount) || 0,
  }), 0);
  const golongan = Number(s.diskon_kategori) || 0;
  const poin = Number(s.poin_digunakan) || 0;
  // `discount` menyimpan seluruh potongan selain diskon golongan; sisanya setelah
  // diskon item dan poin dikeluarkan = diskon manual kasir + voucher.
  const lain = Math.max(0, (Number(s.discount) || 0) - item - poin);
  return { item, golongan, poin, lain, total: item + golongan + poin + lain };
}

const dalamRentang = (iso: string, mulai: string, akhir: string) => {
  const t = Date.parse(iso);
  return t >= Date.parse(mulai) && t <= Date.parse(akhir);
};

/** Struk dihitung bila lolos definisi laporan (bukan batal) DAN pembayarannya final — seperti database. */
const saleDihitung = (s: KampanyeSale) => isCompletedSale(s) && !!s.payments_finalized_at;
const invoiceDihitung = (i: KampanyeInvoice) => !i.voided_at;

export function ringkasKampanye(input: KampanyeInput): KampanyeRow[] {
  const { kode, vouchers, promos, sales, invoices, mulai, akhir, hariIni } = input;
  const voucherById = new Map(vouchers.map((v) => [v.id, v]));
  const promoById = new Map(promos.map((p) => [p.id, p]));

  type Acc = {
    semua: number; pos: number; klinik: number; tidak: number;
    omzetPos: number; omzetKlinik: number; promoPos: number; diskon: number;
    cabang: Map<string, number>;
  };
  const acc = new Map<string, Acc>();
  const ambil = (code: string) => {
    let a = acc.get(code);
    if (!a) { a = { semua: 0, pos: 0, klinik: 0, tidak: 0, omzetPos: 0, omzetKlinik: 0, promoPos: 0, diskon: 0, cabang: new Map() }; acc.set(code, a); }
    return a;
  };
  const tujuanPromo = new Map(kode.filter((k) => k.promo_id).map((k) => [k.code, k.promo_id as string]));
  const cabangTambah = (a: Acc, nama: string) => a.cabang.set(nama, (a.cabang.get(nama) ?? 0) + 1);

  for (const s of sales) {
    if (!s.campaign_code) continue;
    const a = ambil(s.campaign_code);
    const hitung = saleDihitung(s);
    if (hitung) a.semua++;
    if (!dalamRentang(s.created_at, mulai, akhir)) continue;
    if (!hitung) { a.tidak++; continue; }
    a.pos++;
    a.omzetPos += Number(s.total) || 0;
    a.diskon += diskonSale(s).total;
    const promoId = tujuanPromo.get(s.campaign_code);
    if (promoId) for (const l of s.sale_items ?? []) if (l.promo_id === promoId) a.promoPos += Number(l.promo_discount) || 0;
    cabangTambah(a, one(s.branches)?.name ?? "—");
  }
  for (const i of invoices) {
    if (!i.campaign_code) continue;
    const a = ambil(i.campaign_code);
    const hitung = invoiceDihitung(i);
    if (hitung) a.semua++;
    if (!dalamRentang(i.created_at, mulai, akhir)) continue;
    if (!hitung) { a.tidak++; continue; }
    a.klinik++;
    a.omzetKlinik += Number(i.total) || 0;
    a.diskon += Number(i.discount) || 0;
    cabangTambah(a, one(one(i.visits)?.branches ?? null)?.name ?? "—");
  }

  const kosong = (): Acc => ({ semua: 0, pos: 0, klinik: 0, tidak: 0, omzetPos: 0, omzetKlinik: 0, promoPos: 0, diskon: 0, cabang: new Map() });
  const bentuk = (k: KampanyeKode | null, code: string): KampanyeRow => {
    const a = acc.get(code) ?? kosong();
    const jenis = k ? (k.voucher_id ? "voucher" : "promo") : null;
    const target = k ? (k.voucher_id ? voucherById.get(k.voucher_id) : promoById.get(k.promo_id ?? "")) : null;
    const tujuan = !k ? "(kode sudah dihapus)"
      : k.voucher_id ? `Voucher ${voucherById.get(k.voucher_id)?.code ?? "?"}` : `Promo ${promoById.get(k.promo_id ?? "")?.name ?? "?"}`;
    const akhirBerlaku = target?.valid_until ?? null;
    // Urutan sama dengan layar Kode Kampanye: masa berlaku tujuan lewat menang atas is_active.
    const status = !k ? "dihapus" : akhirBerlaku && akhirBerlaku < hariIni ? "kadaluarsa" : k.is_active ? "aktif" : "nonaktif";
    const maxUses = k?.max_uses ?? null;
    const potongan = jenis === "promo"
      ? { pos: a.promoPos, eksak: a.klinik === 0 }
      : { pos: null, eksak: false };
    return {
      id: k?.id ?? null, code, jenis, tujuan, status, maxUses,
      terpakaiSemua: a.semua,
      sisa: maxUses == null ? null : Math.max(0, maxUses - a.semua),
      pakai: a.pos + a.klinik, pakaiPos: a.pos, pakaiKlinik: a.klinik, tidakDihitung: a.tidak,
      omzetPos: a.omzetPos, omzetKlinik: a.omzetKlinik, omzet: a.omzetPos + a.omzetKlinik,
      potongan, diskonDokumen: a.diskon,
      cabang: [...a.cabang].map(([nama, n]) => ({ nama, n })).sort((x, y) => y.n - x.n || x.nama.localeCompare(y.nama, "id")),
      note: k?.note ?? null,
    };
  };

  const master = new Set(kode.map((k) => k.code));
  const rows = [
    ...kode.map((k) => bentuk(k, k.code)),
    ...[...acc.keys()].filter((c) => !master.has(c)).map((c) => bentuk(null, c)),
  ];
  return rows.sort((a, b) => b.pakai - a.pakai || a.code.localeCompare(b.code));
}

// Tabel/kolom kampanye belum ada di database (migrasi belum diterapkan): bagian ini saja yang
// dinyatakan tidak tersedia; galat lain tetap dilempar supaya laporan tidak diam-diam kosong.
const GALAT_SKEMA = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

type Reader = <T>(q: never) => Promise<{ data: T[]; error: null }>;
type Klien = { from: (t: string) => { select: (...a: unknown[]) => unknown } };

export async function muatKampanye(
  supabase: Klien,
  baca: Reader = completeReportQuery as unknown as Reader,
): Promise<{ tersedia: boolean; kode: KampanyeKode[]; sales: KampanyeSale[]; invoices: KampanyeInvoice[] }> {
  // Seumur hidup (tanpa filter tanggal): kuota dihitung dari semua pemakaian, rentang disaring di ringkasKampanye.
  const q = (tabel: string, kolom: string) => supabase.from(tabel).select(kolom, { count: "exact" }) as never;
  try {
    const [kode, sales, invoices] = await Promise.all([
      baca<KampanyeKode>(q("campaign_codes", "id, code, voucher_id, promo_id, max_uses, is_active, note")),
      baca<KampanyeSale>(((q("sales",
        "id, total, discount, diskon_kategori, poin_digunakan, created_at, campaign_code, payment_plan, payments_finalized_at, voided_at, branches(name), sale_items(qty, harga, item_discount_type, item_discount_value, promo_id, promo_discount)") as { not: (c: string, o: string, v: null) => never }).not("campaign_code", "is", null)) as never),
      baca<KampanyeInvoice>(((q("invoices",
        "id, total, discount, created_at, campaign_code, voided_at, visits(branch_id, branches(name))") as { not: (c: string, o: string, v: null) => never }).not("campaign_code", "is", null)) as never),
    ]);
    return { tersedia: true, kode: kode.data, sales: sales.data, invoices: invoices.data };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code && GALAT_SKEMA.has(code)) return { tersedia: false, kode: [], sales: [], invoices: [] };
    throw e;
  }
}
