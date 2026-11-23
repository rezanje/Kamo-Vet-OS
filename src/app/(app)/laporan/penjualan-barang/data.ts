import { readReportRows } from "@/lib/hpp-reports-server";
import { completeReportQuery } from "@/lib/report-query";
import { createClient } from "@/lib/supabase/server";
import { allowedBranchIds } from "@/lib/branch-access";
import { batasTanggalWIB } from "@/lib/laporan-transaksi";
import { lineDiscount } from "@/lib/pos-calc";
import { PosDecimal } from "@/lib/pos-money";
import { jenisBarisKlinik, kunciRacikan, perluCocokNamaRacikan, SEMUA_JENIS_KLINIK, type JenisBarisPenjualan } from "@/lib/laporan-penjualan-barang";
import { namaRacikanPerKunjungan } from "@/lib/racikan-klinik-server";
import { BATAS_BACA_LAPORAN, petaBerbatas } from "@/lib/konkuren-batas";
import { bacaAnakPerInduk } from "@/lib/laporan-baca-berkelompok";
import { bacaStrukKasirCepat } from "@/lib/laporan-struk-kasir";
import { bacaInvoiceKlinikCepat } from "@/lib/laporan-invoice-klinik";
import { klasifikasiGalatLaporan, type KodeGalatLaporan } from "@/lib/laporan-galat";
import type { Kanal } from "@/lib/laporan-transaksi";
import { fakturGrosirOmzet, hppBarisGrosir, nilaiBarisGrosir, SELECT_FAKTUR_GROSIR, type FakturGrosirInti } from "@/lib/laporan-grosir";
import { isCompletedSale, type SaleCompletion } from "@/lib/sale-payment-reporting";
import { servicePerformerNames, type ServicePerformersSnapshot } from "@/lib/service-performers";
import { loadClinicItemCategories } from "@/lib/clinic-item-categories";
import { cocokKategori, klasifikasiBaris, petaKategori, ringkasKategori, type ItemKategori, type KategoriNode, type RingkasanKategori } from "@/lib/laporan-kategori-penjualan";

type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>): T | null => Array.isArray(value) ? (value[0] ?? null) : value;
export const waktuWIB = (value: string) => new Date(value).toLocaleString("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

type HubunganVisit = {
  branch_id: string | null;
  branches: Rel<{ name: string }>;
  customers: Rel<{ name: string }>;
  pets: Rel<{ name: string }>;
};
/** K02/pekerjaan pesanan: BMHP yang dipakai pada satu baris tindakan klinik. */
type BmhpSnapshot = { cost?: number | null; components?: { name?: string | null; qty?: number | null; unit?: string | null; cost?: number | null }[] | null };
type InvoiceItem = {
  id: string; deskripsi: string; qty: number; harga: number; diskon_persen: number;
  jenis: string | null; item_id: string | null; compound_recipe_id: string | null;
  bmhp_components: BmhpSnapshot | null;
  service_performers: ServicePerformersSnapshot | null;
  invoices: Rel<{
    id: string; visit_id: string; invoice_no: string | null; created_at: string; paid_status: string;
    subtotal: number; discount: number;
    visits: Rel<HubunganVisit>;
  }>;
};
/** Satu invoice klinik seperti dibaca laporan: induk baris item (tanpa baris item sendiri). */
type InvoiceInduk = NonNullable<Exclude<InvoiceItem["invoices"], unknown[]>>;
type SaleItem = {
  id: string; nama: string; qty: number; harga: number; item_id?: string | null;
  service_performers: ServicePerformersSnapshot | null;
  item_discount_type: "nominal" | "percent" | null;
  item_discount_value: number | null; promo_discount: number | null;
  sales: Rel<SaleCompletion & {
    id: string; branch_id: string | null; no_struk: string | null; created_at: string; channel: string | null;
    total: number; merchant_fee_total: number | null;
    branches: Rel<{ name: string }>; customers: Rel<{ name: string }>;
  }>;
};
/** Faktur grosir seperti dibaca baris item: cukup untuk menyaring dan menamai barisnya. */
type FakturGrosirBaris = FakturGrosirInti & {
  no_faktur: string | null; branch_id: string | null; tanggal: string;
  branches: Rel<{ name: string }>; customers: Rel<{ name: string }>;
};
type GrosirItem = {
  id: string; nama: string; satuan: string | null; qty: number; harga: number;
  diskon: number | null; hpp: number | null; item_id: string | null;
  sales_invoices: Rel<FakturGrosirBaris>;
};
export type Baris = {
  id: string; waktu: string; dokumen: string; href: string; kanal: Kanal;
  jenis: JenisBarisPenjualan; cabang: string; cabangId: string | null; pelanggan: string; hewan: string;
  nama: string; pelaksana: string; qty: number; harga: number; diskon: number; nilai: number; status: string;
  /** Kode barang (items.code), kategori induk huruf besar, dan sub kategori (anak langsung induk). Hanya tampilan; tidak memengaruhi nilai. */
  kode: string; kategori: string; subKategori: string;
  pelaksanaIds?: string[];
  /** Baris anak BMHP: id baris induknya. Nilainya 0 dan tidak masuk total. */
  indukId?: string;
  satuan?: string;
  hpp?: number;
};
export type PilihanPelaksana = { id: string; nama: string };

function pelaksanaBaris(value: ServicePerformersSnapshot | null | undefined): { ids: string[]; pilihan: PilihanPelaksana[] } {
  if (!value) return { ids: [], pilihan: [] };
  const pilihan = [
    value.doctor_id ? { id: value.doctor_id, nama: `Dokter: ${value.doctor_name || `ID ${value.doctor_id.slice(-8)}`}` } : null,
    value.staff_id ? { id: value.staff_id, nama: `Pelaksana: ${value.staff_name || `ID ${value.staff_id.slice(-8)}`}` } : null,
  ].filter((row): row is PilihanPelaksana => row !== null);
  return { ids: pilihan.map(row => row.id), pilihan };
}

/** Satu pembacaan kategori (seluruh pohon) dan item yang dipakai dikelompokkan per 100 id. Gagal baca -> kosong (TANPA KATEGORI), laporan tetap jalan. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bacaKategoriBarang(supabase: any, itemIds: Iterable<string | null | undefined>): Promise<{ items: Map<string, ItemKategori>; peta: ReadonlyMap<string, KategoriNode> }> {
  const ids = [...new Set([...itemIds].filter((id): id is string => !!id))];
  const items = new Map<string, ItemKategori>();
  if (!ids.length) return { items, peta: petaKategori([]) };
  const [daftarItem, kategori] = await Promise.all([
    Promise.all(potong(ids).map(batch => readReportRows<{ id: string; code: string | null; category_id: string | null }>(async (awal, ujung) => {
      const { data, error, count } = await supabase.from("items").select("id, code, category_id", { count: "exact" }).in("id", batch).order("id").range(awal, ujung);
      return { data, error, count };
    }))).then(batches => batches.flat()).catch(error => { console.error("Kode/kategori barang laporan gagal dibaca:", error); return []; }),
    loadClinicItemCategories(supabase).catch(error => { console.error("Kategori barang laporan gagal dibaca:", error); return [] as KategoriNode[]; }),
  ]);
  for (const item of daftarItem) items.set(item.id, item);
  return { items, peta: petaKategori(kategori) };
}

function potong<T>(items: T[], ukuran = 100): T[][] {
  const hasil: T[][] = [];
  for (let i = 0; i < items.length; i += ukuran) hasil.push(items.slice(i, i + ukuran));
  return hasil;
}

export function tanggalValid(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function alokasiNetoBaris(bases: InstanceType<typeof PosDecimal>[], target: InstanceType<typeof PosDecimal>): number[] {
  const targetCents = target.times(100).toDecimalPlaces(0).toNumber();
  const baseTotal = bases.reduce((sum, value) => sum.plus(value), new PosDecimal(0));
  if (!Number.isSafeInteger(targetCents) || targetCents < 0
    || new PosDecimal(targetCents).div(100).gt(baseTotal.toDecimalPlaces(2))
    || bases.some(value => value.isNegative())) {
    throw new Error("Nilai dokumen tidak cocok dengan baris untuk laporan per item.");
  }
  let cumulative = new PosDecimal(0), allocated = 0;
  return bases.map(base => {
    cumulative = cumulative.plus(base);
    const next = baseTotal.isZero() ? 0 : new PosDecimal(targetCents).times(cumulative).div(baseTotal).toDecimalPlaces(0).toNumber();
    const net = (next - allocated) / 100;
    allocated = next;
    return net;
  });
}


/** Biaya admin DEMO yang ditanggung pelanggan per invoice (snapshot). Kelompok id dibaca bersamaan. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bacaBiayaAdminDemo(supabase: any, invoiceIds: string[]): Promise<Map<string, number>> {
  const demoFees = new Map<string, number>();
  const kelompok = await petaBerbatas(potong(invoiceIds), BATAS_BACA_LAPORAN, batch => readReportRows<{ invoice_id: string; fee_amount: number; fee_bearer: string }>(async (from, to) => {
    const { data, error, count } = await supabase.from("clinic_demo_invoice_snapshots")
      .select("invoice_id,fee_amount,fee_bearer", { count: "exact" }).in("invoice_id", batch)
      .order("invoice_id").range(from, to);
    return { data, error, count };
  }, row => row.invoice_id));
  for (const snapshot of kelompok.flat()) {
    if (snapshot.fee_bearer === "customer" && Number(snapshot.fee_amount) > 0) {
      demoFees.set(snapshot.invoice_id, Number(snapshot.fee_amount));
    }
  }
  return demoFees;
}

const KOLOM_ITEM_KLINIK = "id, invoice_id, deskripsi, qty, harga, diskon_persen, jenis, item_id, compound_recipe_id, bmhp_components, service_performers";

/**
 * Baris invoice klinik dalam periode. Dulu satu query `invoice_items` bergabung (`invoices!inner(... visits ...)`)
 * dibaca per halaman 500 dan setiap halaman menghitung ulang seluruh gabungan beserta cek hak akses cabang (RLS)
 * untuk tiap baris: ±3 detik per query, ±22 query -> melewati batas 8 detik database.
 * Sekarang invoice (±1.300) dan kunjungannya dibaca satu kali, lalu baris itemnya diambil per kelompok id invoice
 * secara bersamaan (batas kecil). Hasil akhirnya (baris, urutan id, isi invoice) sama dengan gabungan lama.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bacaInvoiceKlinik(supabase: any, dari: string, sampai: string, mulai: string, akhir: string, saringCabang: string): Promise<{ items: InvoiceItem[]; demoFees: Map<string, number>; namaRacikan: Set<string> }> {
  // Jalur utama: satu fungsi baca-saja di database per rentang 7 hari (migrasi 20261203100000, hak baca sama dengan RLS) —
  // invoice, kunjungan, item, snapshot DEMO, dan nama racikan sekaligus. Jalur lama di bawah hanya bila fungsinya belum ada.
  const cepat = await bacaInvoiceKlinikCepat(supabase, { dari, sampai, cabangId: saringCabang });
  if (cepat) {
    const perIdCepat = new Map(cepat.invoices.map(i => [i.id, {
      id: i.id, visit_id: i.visit_id, invoice_no: i.invoice_no, created_at: i.created_at, paid_status: i.paid_status,
      subtotal: i.subtotal, discount: i.discount,
      visits: { branch_id: i.visits.branch_id, branches: i.visits.branches, customers: i.visits.customers, pets: i.visits.pets },
    } as unknown as InvoiceInduk] as const));
    const biayaDemo = new Map<string, number>();
    for (const snapshot of cepat.demo) {
      if (snapshot.fee_bearer === "customer" && Number(snapshot.fee_amount) > 0) biayaDemo.set(snapshot.invoice_id, Number(snapshot.fee_amount));
    }
    return {
      items: cepat.items.map(i => {
        const invoice = perIdCepat.get(i.invoice_id);
        if (!invoice) throw new Error("Invoice sumber baris laporan tidak dapat diverifikasi.");
        return {
          id: i.id, deskripsi: i.deskripsi, qty: i.qty, harga: i.harga, diskon_persen: i.diskon_persen, jenis: i.jenis, item_id: i.item_id,
          compound_recipe_id: i.compound_recipe_id, bmhp_components: i.bmhp_components, service_performers: i.service_performers, invoices: invoice,
        } as unknown as InvoiceItem;
      }),
      demoFees: biayaDemo,
      namaRacikan: new Set(cepat.racikan.map(r => kunciRacikan(r.visit_id, r.recipe_name))),
    };
  }
  const invoices = await readReportRows<InvoiceInduk>(async (awal, ujung) => {
    const query = supabase.from("invoices")
      .select(`id, visit_id, invoice_no, created_at, paid_status, subtotal, discount, visits${saringCabang ? "!inner" : ""}(branch_id, branches(name), customers(name), pets(name))`, { count: "exact" })
      .is("voided_at", null)
      .gte("created_at", mulai).lte("created_at", akhir);
    const { data, error, count } = await (saringCabang ? query.eq("visits.branch_id", saringCabang) : query)
      .order("id").range(awal, ujung);
    return { data: data as unknown as InvoiceInduk[] | null, error, count };
  }, undefined, { paralel: BATAS_BACA_LAPORAN });
  const perId = new Map(invoices.map(invoice => [invoice.id, invoice] as const));
  // Baris item dan snapshot biaya admin DEMO tidak saling bergantung: dibaca bersamaan.
  // Invoice tanpa baris item ikut dicari (himpunan sedikit lebih luas); hasilnya hanya dipakai lewat id invoice/kunjungan baris item.
  const [kelompok, demoFees] = await Promise.all([
    petaBerbatas(potong([...perId.keys()]), BATAS_BACA_LAPORAN, batch => readReportRows<InvoiceItem & { invoice_id: string }>(async (awal, ujung) => {
      const { data, error, count } = await supabase.from("invoice_items")
        .select(KOLOM_ITEM_KLINIK, { count: "exact" }).in("invoice_id", batch)
        .order("id").range(awal, ujung);
      return { data: data as unknown as (InvoiceItem & { invoice_id: string })[] | null, error, count };
    })),
    bacaBiayaAdminDemo(supabase, [...perId.keys()]),
  ]);
  // Invoice menyimpan nama racikan sebagai baris obat biasa. Cocokkan nama dengan resep di kunjungan sama agar racikan
  // terpisah dari obat ketikan, tetapi hanya untuk kunjungan yang punya baris tanpa tautan (hanya baris itu yang dicocokkan;
  // membaca rekam medis + resep seluruh kunjungan periode lewat RLS berat dan tidak mengubah hasil).
  const kunjunganKandidat = kelompok.flat().filter(perluCocokNamaRacikan)
    .flatMap(item => { const visitId = perId.get(item.invoice_id)?.visit_id; return visitId ? [visitId] : []; });
  const namaRacikan = await namaRacikanPerKunjungan(supabase, kunjunganKandidat);
  // Urutan akhir = urutan id baris item, seperti `order("id")` pada query lama (alokasi neto per invoice bergantung pada urutan ini).
  const items = kelompok.flat().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(({ invoice_id: invoiceId, ...item }) => {
    const invoice = perId.get(invoiceId);
    if (!invoice) throw new Error("Invoice sumber baris laporan tidak dapat diverifikasi.");
    return { ...item, invoices: invoice } as InvoiceItem;
  });
  return { items, demoFees, namaRacikan };
}

type SaleInduk = NonNullable<Exclude<SaleItem["sales"], unknown[]>>;
const KOLOM_ITEM_KASIR = "id, sale_id, nama, qty, harga, item_id, item_discount_type, item_discount_value, promo_discount, service_performers";

/**
 * Baris struk kasir dalam periode. Jalur utama: satu fungsi baca-saja di database (migrasi 20261202200000, hak baca sama
 * dengan RLS) per rentang 7 hari, bukan ±115 query (struk per halaman 500 + hitungan pasti + item per 100 id struk) yang
 * memeriksa hak cabang per baris dan melewati batas 8 detik database pada periode panjang.
 * Jalur lama (struk sekali, item per kelompok 100 id struk) hanya dipakai bila fungsinya belum ada. Isi baris sama.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bacaItemKasir(supabase: any, dari: string, sampai: string, mulai: string, akhir: string, saringCabang: string): Promise<SaleItem[]> {
  const cepat = await bacaStrukKasirCepat(supabase, { dari, sampai, cabangId: saringCabang });
  if (cepat) {
    const perStruk = new Map(cepat.sales.map(s => [s.id, {
      id: s.id, branch_id: s.branch_id, no_struk: s.no_struk, created_at: s.created_at, channel: s.channel, total: s.total,
      merchant_fee_total: s.merchant_fee_total, payment_plan: s.payment_plan, payments_finalized_at: s.payments_finalized_at,
      voided_at: s.voided_at, branches: s.branches, customers: s.customers,
    } as unknown as SaleInduk] as const));
    return cepat.items.map(i => {
      const sale = perStruk.get(i.sale_id);
      if (!sale) throw new Error("Struk sumber baris laporan tidak dapat diverifikasi.");
      return {
        id: i.id, nama: i.nama, qty: i.qty, harga: i.harga, item_id: i.item_id,
        item_discount_type: i.item_discount_type, item_discount_value: i.item_discount_value, promo_discount: i.promo_discount,
        service_performers: i.service_performers as ServicePerformersSnapshot | null, sales: sale,
      } as SaleItem;
    });
  }
  const struk = await readReportRows<SaleInduk>(async (awal, ujung) => {
    const query = supabase.from("sales")
      .select("id, branch_id, no_struk, created_at, channel, total, merchant_fee_total, payment_plan, payments_finalized_at, voided_at, branches(name), customers(name)", { count: "exact" })
      .gte("created_at", mulai).lte("created_at", akhir);
    const { data, error, count } = await (saringCabang ? query.eq("branch_id", saringCabang) : query)
      .order("id").range(awal, ujung);
    return { data: data as unknown as SaleInduk[] | null, error, count };
  }, undefined, { paralel: BATAS_BACA_LAPORAN });
  const perId = new Map(struk.map(sale => [sale.id, sale] as const));
  const item = await bacaAnakPerInduk<SaleItem & { sale_id: string }>(perId.keys(), async (batch, awal, ujung) => {
    const { data, error, count } = await supabase.from("sale_items")
      .select(KOLOM_ITEM_KASIR, { count: "exact" }).in("sale_id", batch).order("id").range(awal, ujung);
    return { data: data as unknown as (SaleItem & { sale_id: string })[] | null, error, count };
  });
  return item.map(({ sale_id: saleId, ...baris }) => {
    const sale = perId.get(saleId);
    if (!sale) throw new Error("Struk sumber baris laporan tidak dapat diverifikasi.");
    return { ...baris, sales: sale } as SaleItem;
  });
}

/** Faktur grosir (tanggal faktur) dibaca sekali, item per kelompok id faktur; hasil sama dengan gabungan lama. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bacaItemGrosir(supabase: any, dari: string, sampai: string): Promise<GrosirItem[]> {
  const faktur = await readReportRows<FakturGrosirBaris>(async (awal, ujung) => {
    const { data, error, count } = await supabase.from("sales_invoices")
      .select(`${SELECT_FAKTUR_GROSIR}, branches(name), customers(name)`, { count: "exact" })
      .gte("tanggal", dari).lte("tanggal", sampai).order("id").range(awal, ujung);
    return { data: data as unknown as FakturGrosirBaris[] | null, error, count };
  }, undefined, { paralel: BATAS_BACA_LAPORAN });
  const perId = new Map(faktur.map(f => [f.id, f] as const));
  const item = await bacaAnakPerInduk<GrosirItem & { invoice_id: string }>(perId.keys(), async (batch, awal, ujung) => {
    const { data, error, count } = await supabase.from("sales_invoice_items")
      .select("id, invoice_id, nama, satuan, qty, harga, diskon, hpp, item_id", { count: "exact" }).in("invoice_id", batch).order("id").range(awal, ujung);
    return { data: data as unknown as (GrosirItem & { invoice_id: string })[] | null, error, count };
  });
  return item.map(({ invoice_id: fakturId, ...baris }) => {
    const f = perId.get(fakturId);
    if (!f) throw new Error("Faktur grosir sumber baris laporan tidak dapat diverifikasi.");
    return { ...baris, sales_invoices: f } as GrosirItem;
  });
}

export type OpsiCabang = { id: string; name: string };

/**
 * A1 (meeting 12 Nov 2026): isian filter cabang tanpa membaca baris penjualan —
 * cabang aktif yang boleh diakses pengguna. Dipakai sebelum Tampilkan ditekan, dan
 * untuk memvalidasi id cabang sebelum disaring di query.
 */
export async function ambilOpsiCabangPenjualanBarang(): Promise<OpsiCabang[]> {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const [diizinkan, { data }] = await Promise.all([
      auth?.user ? allowedBranchIds(supabase, auth.user.id) : Promise.resolve([] as string[]),
      completeReportQuery(supabase.from("branches").select("id, name", { count: "exact" }).eq("is_active", true)),
    ]);
    return ((data ?? []) as OpsiCabang[])
      .filter((cabang) => diizinkan === null || diizinkan.includes(cabang.id))
      .sort((a, b) => a.name.localeCompare(b.name, "id") || a.id.localeCompare(b.id));
  } catch (error) {
    console.error("Pilihan cabang laporan penjualan per barang gagal:", error);
    return [];
  }
}

export async function ambilPenjualanBarang({ dari, sampai, kanal, jenis, q, cabangId = "", pelaksanaId = "", kategori = "", saringCabangDiQuery = false }: {
  dari: string; sampai: string; kanal: Kanal;
  jenis: string; q: string; cabangId?: string; pelaksanaId?: string; kategori?: string;
  /**
   * A1: true = `cabangId` (sudah divalidasi pemanggil; kolomnya uuid) ikut disaring di
   * query struk & invoice klinik. Bawaan false = perilaku lama (dipakai rute unduh).
   * Faktur grosir tetap disaring di memori: faktur koreksi menandai faktur asalnya dari
   * kumpulan yang sama.
   */
  saringCabangDiQuery?: boolean;
}): Promise<{ rows: Baris[]; cabangOptions: { id: string; name: string }[]; pelaksanaOptions: PilihanPelaksana[]; pesanError: string; kodeError?: KodeGalatLaporan; nilaiTotal: number; qtyTotal: number; ringkasan: RingkasanKategori; kategoriOptions: string[] }> {
  const tanggalSalah = !tanggalValid(dari) || !tanggalValid(sampai) || dari > sampai;
  const { mulai, akhir } = batasTanggalWIB(dari, sampai);
  const rows: Baris[] = [];
  const anakBmhp = new Map<string, Baris[]>();
  const itemIdBaris = new Map<string, string | null>();
  const pilihanPelaksana = new Map<string, PilihanPelaksana>();
  let pesanError = tanggalSalah ? "Rentang tanggal tidak valid. Periksa tanggal awal dan akhir." : "";
  let kodeError: KodeGalatLaporan | undefined;
  if (!tanggalSalah) {
    try {
      const supabase = await createClient();
      const saringCabang = saringCabangDiQuery ? cabangId : "";
      const bacaKlinik = kanal === "Klinik";
      const bacaKasir = kanal === "POS" || kanal === "Online";
      const bacaGrosir = kanal === "Grosir";
      const [{ items: invoiceItems, demoFees, namaRacikan }, saleItems, grosirItems] = await Promise.all([
        bacaKlinik ? bacaInvoiceKlinik(supabase, dari, sampai, mulai, akhir, saringCabang) : Promise.resolve({ items: [] as InvoiceItem[], demoFees: new Map<string, number>(), namaRacikan: new Set<string>() }),
        bacaKasir ? bacaItemKasir(supabase, dari, sampai, mulai, akhir, saringCabang) : Promise.resolve([] as SaleItem[]),
        // Faktur grosir disaring lewat tanggal faktur (date, sudah WIB), bukan created_at.
        bacaGrosir ? bacaItemGrosir(supabase, dari, sampai) : Promise.resolve([] as GrosirItem[]),
      ]);

      const clinicLines = new Map<string, InvoiceItem[]>();
      for (const item of invoiceItems) {
        const invoice = one(item.invoices);
        if (!invoice?.id) throw new Error("Invoice sumber baris laporan tidak dapat diverifikasi.");
        if (!clinicLines.has(invoice.id)) clinicLines.set(invoice.id, []);
        clinicLines.get(invoice.id)!.push(item);
      }
      const netoKlinik = new Map<string, number>();
      const feeLineIds = new Set<string>();
      for (const items of clinicLines.values()) {
        const invoice = one(items[0].invoices)!;
        const fee = demoFees.get(invoice.id) ?? 0;
        const feeItems = fee ? items.filter(item => item.deskripsi === "Admin pembayaran DEMO" && !item.item_id
          && Number(item.qty) === 1 && Number(item.harga) === fee && Number(item.diskon_persen || 0) === 0) : [];
        if (fee && feeItems.length !== 1) throw new Error("Baris biaya admin DEMO tidak cocok dengan snapshot invoice.");
        const ordinary = fee ? items.filter(item => item.id !== feeItems[0].id) : items;
        const bases = ordinary.map(item => {
          const percent = Math.min(100, Math.max(0, Number(item.diskon_persen) || 0));
          return new PosDecimal(item.qty).times(item.harga).times(new PosDecimal(1).minus(new PosDecimal(percent).div(100)));
        });
        const net = alokasiNetoBaris(bases, new PosDecimal(invoice.subtotal).minus(invoice.discount).minus(fee));
        ordinary.forEach((item, index) => netoKlinik.set(item.id, net[index]));
        if (fee) {
          netoKlinik.set(feeItems[0].id, fee);
          feeLineIds.add(feeItems[0].id);
        }
      }

      // Alokasikan selisih neto struk POS setelah diskon baris. Nilai struk
      // tersimpan adalah sumber kebenaran; fee merchant bukan pendapatan item.
      const posLines = new Map<string, SaleItem[]>();
      for (const item of saleItems) {
        const sale = one(item.sales);
        if (!sale || sale.channel || !isCompletedSale(sale)) continue;
        if (!posLines.has(sale.id)) posLines.set(sale.id, []);
        posLines.get(sale.id)!.push(item);
      }
      const netoPos = new Map<string, number>();
      for (const items of posLines.values()) {
        const sale = one(items[0].sales)!;
        const bases = items.map(item => new PosDecimal(item.qty).times(item.harga).minus(lineDiscount(item)));
        const net = alokasiNetoBaris(bases, new PosDecimal(sale.total).minus(sale.merchant_fee_total ?? 0));
        items.forEach((item, index) => netoPos.set(item.id, net[index]));
      }

      for (const item of invoiceItems) {
        const invoice = one(item.invoices);
        if (!invoice?.id) throw new Error("Invoice sumber baris laporan tidak dapat diverifikasi.");
        const visit = one(invoice.visits);
        const barisId = `klinik-${item.id}`;
        const nilai = netoKlinik.get(item.id);
        if (nilai == null) throw new Error("Alokasi nilai baris invoice klinik tidak tersedia.");
        const jenis = feeLineIds.has(item.id) ? "Biaya Admin" : jenisBarisKlinik(item, invoice.visit_id, namaRacikan);
        const pelaksana = jenis === "Jasa" || item.service_performers != null ? pelaksanaBaris(item.service_performers) : { ids: [], pilihan: [] };
        pelaksana.pilihan.forEach(pilihan => pilihanPelaksana.set(pilihan.id, pilihan));
        rows.push({
          id: barisId, waktu: invoice.created_at, dokumen: invoice.invoice_no ?? "—",
          href: `/klinik/pembayaran/${invoice.visit_id}/invoice?invoice_id=${encodeURIComponent(invoice.id)}`, kanal: "Klinik",
          jenis,
          cabang: one(visit?.branches ?? null)?.name ?? "—",
          cabangId: visit?.branch_id ?? null,
          pelanggan: one(visit?.customers ?? null)?.name ?? "—",
          hewan: one(visit?.pets ?? null)?.name ?? "—",
          nama: item.deskripsi, pelaksana: jenis === "Jasa" || item.service_performers != null ? servicePerformerNames(item.service_performers).join(" · ") : "—",
          pelaksanaIds: pelaksana.ids,
          qty: Number(item.qty) || 0, harga: Number(item.harga) || 0,
          diskon: Math.max(0, (Number(item.qty) || 0) * (Number(item.harga) || 0) - nilai),
          nilai, status: invoice.paid_status, kode: "", kategori: "", subKategori: "",
        });
        itemIdBaris.set(barisId, item.item_id);
        // BMHP tampil sebagai baris anak: jumlah, satuan dan HPP-nya terlihat, tetapi
        // nilai jualnya 0 supaya omzet baris tindakan tidak terhitung dua kali.
        const bmhp = (item.bmhp_components?.components ?? []).filter(row => row && typeof row === "object");
        bmhp.forEach((material, index) => {
          const anak: Baris = {
            id: `${barisId}-bmhp-${index}`, indukId: barisId, waktu: invoice.created_at,
            dokumen: invoice.invoice_no ?? "—",
            href: `/klinik/pembayaran/${invoice.visit_id}/invoice?invoice_id=${encodeURIComponent(invoice.id)}`, kanal: "Klinik",
            jenis, cabang: one(visit?.branches ?? null)?.name ?? "—", cabangId: visit?.branch_id ?? null,
            pelanggan: one(visit?.customers ?? null)?.name ?? "—", hewan: one(visit?.pets ?? null)?.name ?? "—",
            nama: `BMHP · ${material.name ?? "Bahan"}`, pelaksana: "—",
            qty: Number(material.qty) || 0, satuan: material.unit ?? undefined, hpp: Number(material.cost) || 0,
            harga: 0, diskon: 0, nilai: 0, status: invoice.paid_status, kode: "", kategori: "", subKategori: "",
          };
          anakBmhp.set(barisId, [...(anakBmhp.get(barisId) ?? []), anak]);
        });
      }
      for (const item of saleItems) {
        const sale = one(item.sales);
        if (!sale || !isCompletedSale(sale)) continue;
        const itemKanal = sale.channel ? "Online" : "POS";
        if (kanal !== itemKanal) continue;
        const qty = Number(item.qty) || 0;
        const harga = Number(item.harga) || 0;
        const diskon = lineDiscount({
          qty, harga, item_discount_type: item.item_discount_type,
          item_discount_value: item.item_discount_value, promo_discount: item.promo_discount,
        });
        const nilai = itemKanal === "POS" ? netoPos.get(item.id) : qty * harga - diskon;
        if (nilai == null) throw new Error("Alokasi nilai baris POS tidak tersedia.");
        const pelaksana = pelaksanaBaris(item.service_performers);
        pelaksana.pilihan.forEach(pilihan => pilihanPelaksana.set(pilihan.id, pilihan));
        rows.push({
          id: `kasir-${item.id}`, waktu: sale.created_at, dokumen: sale.no_struk ?? "—",
          href: `/penjualan/${sale.id}`, kanal: itemKanal, jenis: "Barang",
          cabang: one(sale.branches)?.name ?? "—", pelanggan: one(sale.customers)?.name ?? "—",
          cabangId: sale.branch_id ?? null,
          hewan: "—", nama: item.nama,
          pelaksana: item.service_performers ? servicePerformerNames(item.service_performers).join(" · ") : "—",
          pelaksanaIds: pelaksana.ids,
          qty, harga, diskon: new PosDecimal(qty).times(harga).minus(nilai).toNumber(), nilai, status: "—",
          kode: "", kategori: "", subKategori: "",
        });
        itemIdBaris.set(`kasir-${item.id}`, item.item_id ?? null);
      }
      // Faktur batal, faktur yang sudah diganti faktur koreksi, faktur saldo awal, dan
      // faktur selisih stok opname disaring sekaligus dari kumpulan faktur induknya.
      const fakturGrosir = new Map<string, FakturGrosirBaris>();
      for (const item of grosirItems) {
        const faktur = one(item.sales_invoices);
        if (!faktur?.id) throw new Error("Faktur grosir sumber baris laporan tidak dapat diverifikasi.");
        fakturGrosir.set(faktur.id, faktur);
      }
      const grosirDihitung = new Set(fakturGrosirOmzet([...fakturGrosir.values()]).map(faktur => faktur.id));
      for (const item of grosirItems) {
        const faktur = one(item.sales_invoices)!;
        if (!grosirDihitung.has(faktur.id)) continue;
        const qty = Number(item.qty) || 0;
        const harga = Number(item.harga) || 0;
        const nilai = nilaiBarisGrosir(item);
        const hpp = hppBarisGrosir(item);
        rows.push({
          id: `grosir-${item.id}`,
          // Faktur hanya menyimpan tanggal, bukan jam; dipatok awal hari WIB.
          waktu: `${faktur.tanggal}T00:00:00+07:00`,
          dokumen: faktur.no_faktur ?? "—",
          href: `/penjualan/faktur/${faktur.id}`, kanal: "Grosir", jenis: "Barang",
          cabang: one(faktur.branches)?.name ?? "—", cabangId: faktur.branch_id ?? null,
          pelanggan: one(faktur.customers)?.name ?? "—", hewan: "—",
          nama: item.nama, pelaksana: "—", pelaksanaIds: [],
          qty, harga, diskon: Number(item.diskon) || 0, nilai,
          satuan: item.satuan ?? undefined,
          ...(hpp === null ? {} : { hpp }),
          // Akrual: faktur berjalan tetap omzet, statusnya saja yang belum lunas.
          status: (faktur.status ?? "").trim().toLowerCase() === "lunas" ? "Lunas" : "Belum lunas",
          kode: "", kategori: "", subKategori: "",
        });
        itemIdBaris.set(`grosir-${item.id}`, item.item_id);
      }
      // Kode, kategori, sub kategori: murni keterangan baris. Nilai/qty/jumlah baris tidak disentuh di sini.
      const { items: itemKategori, peta } = await bacaKategoriBarang(supabase, itemIdBaris.values());
      for (const row of rows) {
        Object.assign(row, klasifikasiBaris({ jenis: row.jenis, itemId: itemIdBaris.get(row.id), items: itemKategori, peta }));
        for (const anak of anakBmhp.get(row.id) ?? []) Object.assign(anak, { kode: row.kode, kategori: row.kategori, subKategori: row.subKategori });
      }
    } catch (error) {
      console.error("Laporan penjualan per barang gagal:", error);
      const galat = klasifikasiGalatLaporan(error);
      pesanError = galat.pesan;
      kodeError = galat.kode;
    }
  }

  const cari = q.toLocaleLowerCase("id-ID");
  const cabangOptions = pesanError ? [] : [...new Map(rows.filter(row => row.cabangId)
    .map(row => [row.cabangId!, { id: row.cabangId!, name: row.cabang }] as const)).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "id") || a.id.localeCompare(b.id));
  const pelaksanaOptions = pesanError ? [] : [...pilihanPelaksana.values()]
    .sort((a, b) => a.nama.localeCompare(b.nama, "id") || a.id.localeCompare(b.id));
  const tanpaFilterKategori = pesanError ? [] : rows.filter((row) =>
    (jenis === SEMUA_JENIS_KLINIK || row.jenis === jenis) && (!cabangId || row.cabangId === cabangId) && (!pelaksanaId || row.pelaksanaIds?.includes(pelaksanaId)) && (!cari || [row.nama, row.dokumen, row.cabang, row.pelanggan, row.hewan, row.pelaksana]
      .some((value) => value.toLocaleLowerCase("id-ID").includes(cari))),
  );
  const kategoriOptions = [...new Set(tanpaFilterKategori.map(row => row.kategori))].sort((a, b) => a.localeCompare(b, "id"));
  const terpilih = tanpaFilterKategori.filter(row => cocokKategori(row, kategori))
    .sort((a, b) => b.waktu.localeCompare(a.waktu) || a.id.localeCompare(b.id));
  const nilaiTotal = terpilih.reduce((sum, row) => sum + row.nilai, 0);
  const qtyTotal = terpilih.reduce((sum, row) => sum + row.qty, 0);
  // Baris anak BMHP menyusul induknya dan tidak pernah ikut menghitung total.
  const dengan = terpilih.flatMap(row => [row, ...(anakBmhp.get(row.id) ?? [])]);
  return { rows: dengan, cabangOptions, pelaksanaOptions, pesanError, ...(kodeError ? { kodeError } : {}), nilaiTotal, qtyTotal, ringkasan: ringkasKategori(terpilih), kategoriOptions };
}
