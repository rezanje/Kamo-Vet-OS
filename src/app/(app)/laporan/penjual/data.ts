import { readReportRows } from "@/lib/hpp-reports-server";
import { completeReportQuery } from "@/lib/report-query";
import { createClient } from "@/lib/supabase/server";
import { allowedBranchIds } from "@/lib/branch-access";
import { batasTanggalWIB } from "@/lib/laporan-transaksi";
import { lineSubtotal } from "@/lib/pos-calc";
import { PosDecimal } from "@/lib/pos-money";
import { alokasiPotonganDokumen } from "@/lib/alokasi-potongan";
import { jenisBarisKlinik, perluCocokNamaRacikan, type JenisBarisPenjualan } from "@/lib/laporan-penjualan-barang";
import { namaRacikanPerKunjungan } from "@/lib/racikan-klinik-server";
import { fakturGrosirOmzet, nilaiBarisGrosir, SELECT_FAKTUR_GROSIR, type FakturGrosirInti } from "@/lib/laporan-grosir";
import { isCompletedSale, saleMerchandiseTotal, type SaleCompletion, type SaleMerchantTotal } from "@/lib/sale-payment-reporting";
import { tanggalWIB } from "@/lib/tanggal";
import { hrefInvoiceKlinik } from "@/lib/tautan-dokumen";
import type { ServicePerformersSnapshot } from "@/lib/service-performers";
import type { BarisPenjual } from "@/lib/laporan-tenaga-penjual";
import { bacaAnakPerInduk } from "@/lib/laporan-baca-berkelompok";
import { bacaStrukKasirCepat } from "@/lib/laporan-struk-kasir";
import { klasifikasiGalatLaporan } from "@/lib/laporan-galat";
import { BATAS_BACA_LAPORAN, petaBerbatas } from "@/lib/konkuren-batas";

// Penarikan data laporan Penjualan per Tenaga Penjual.
//
// Dokumen mana yang dihitung mengikuti laporan omzet (Rincian Penjualan per Transaksi):
//   - Petshop : `sales`, struk batal / rencana bayar belum selesai dibuang (`isCompletedSale`),
//               disaring memakai `created_at` dalam jendela WIB.
//   - Klinik  : `invoices` yang tidak dibatalkan, disaring memakai `created_at`.
//               Basisnya tanggal terbit tagihan (akrual), bukan tanggal pelunasan —
//               laporan komisi memakai tanggal pelunasan, jadi angkanya bisa berbeda bulan.
//   - Grosir  : `sales_invoices` lewat `fakturGrosirOmzet` (batal, faktur pengganti,
//               saldo awal, dan faktur selisih stok opname tidak ikut), disaring
//               memakai kolom tanggal faktur.
//
// Nilai per baris memakai `alokasiPotonganDokumen` — rumus yang sama persis dengan
// laporan Komisi, supaya omzet per orang di kedua layar tidak pernah berbeda.

type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

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

/** Baris biaya admin DEMO tidak punya master barang dan bukan obat; jenisnya sendiri. */
const BIAYA_ADMIN_DEMO = "Admin pembayaran DEMO";

// PostgREST "tabel tidak ada" / PostgreSQL "undefined table": migrasi refund klinik belum jalan.
const TABEL_BELUM_ADA = new Set(["PGRST205", "42P01"]);

type VisitRel = {
  branch_id: string | null; doctor_id: string | null;
  branches: Rel<{ name: string }>; customers: Rel<{ name: string }>; pets: Rel<{ name: string }>;
};
type InvoiceRel = {
  id: string; visit_id: string; invoice_no: string | null; created_at: string; total: number;
  salesperson_id: string | null; visits: Rel<VisitRel>;
};
type InvoiceItemRow = {
  id: string; deskripsi: string; qty: number; harga: number; jenis: string | null;
  diskon_persen: number | null;
  item_id: string | null; compound_recipe_id: string | null;
  service_performers: ServicePerformersSnapshot | null; salesperson_id: string | null;
  invoices: Rel<InvoiceRel>;
};

type SaleRel = SaleCompletion & SaleMerchantTotal & {
  id: string; branch_id: string | null; no_struk: string | null; created_at: string;
  salesperson_id: string | null; cashier_id: string | null;
  branches: Rel<{ name: string }>; customers: Rel<{ name: string }>;
};
type SaleItemRow = {
  id: string; nama: string; qty: number; harga: number;
  item_id: string | null; satuan: string | null; faktor: number | null;
  item_discount_type: "nominal" | "percent" | null; item_discount_value: number | null; promo_discount: number | null;
  service_performers: ServicePerformersSnapshot | null; sales: Rel<SaleRel>;
};

type FakturRel = FakturGrosirInti & {
  no_faktur: string | null; branch_id: string | null; tanggal: string; created_by: string | null;
  branches: Rel<{ name: string }>; customers: Rel<{ name: string }>;
  /** Tenaga penjual pilihan di pesanan dasar faktur; kosong = pembuat faktur. */
  sales_orders?: Rel<{ salesperson_id: string | null }>;
};
type GrosirItemRow = {
  id: string; nama: string; qty: number; harga: number; diskon: number | null;
  item_id: string | null; satuan: string | null;
  sales_invoices: Rel<FakturRel>;
};

type ReturRow = {
  id: string; sale_id: string; tanggal: string;
  sales_return_items: {
    id: string; source_line_id: string | null; nama: string | null; qty: number; harga: number;
    /** Qty retur dalam satuan pilihan (baris baru); `qty` selalu satuan dasar. */
    selected_qty?: number | null; satuan?: string | null;
  }[] | null;
};
type RefundRow = {
  id: string; invoice_id: string; tanggal: string;
  clinic_refund_items: { id: string; invoice_item_id: string; qty: number }[] | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bacaKodeBarang(supabase: any, itemIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(itemIds.filter((id): id is string => !!id))];
  const kode = new Map<string, string>();
  try {
    const kelompok = await petaBerbatas(potong(ids), BATAS_BACA_LAPORAN, batch => readReportRows<{ id: string; code: string | null }>(async (awal, ujung) => {
      const { data, error, count } = await supabase.from("items").select("id, code", { count: "exact" }).in("id", batch).order("id").range(awal, ujung);
      return { data, error, count };
    }));
    for (const item of kelompok.flat()) if (item.code) kode.set(item.id, item.code);
  } catch (error) {
    console.error("Kode barang laporan tenaga penjual gagal dibaca:", error);
  }
  return kode;
}

export type PilihanKaryawanPenjual = { id: string; nama: string; jabatan: string | null; branchName: string | null };

export type FakturBelumLunas = {
  id: string; no_faktur: string; tanggal: string; penjualId: string | null;
  nilai: number; dibayar: number; sisa: number;
};

export type DataTenagaPenjual = {
  rows: BarisPenjual[];
  karyawan: PilihanKaryawanPenjual[];
  namaKaryawan: Map<string, string>;
  cabangOptions: { id: string; name: string }[];
  faktur: FakturBelumLunas[];
  /** Bagian total dokumen yang tidak sampai ke baris mana pun (pajak / biaya kepala dokumen). */
  selisihDokumen: number;
  /** Ada baris retur yang baris asalnya tidak bisa dipastikan, jadi pemiliknya tidak ditebak. */
  returTanpaSumber: number;
  pesanError: string;
};

const kosong = (pesanError: string): DataTenagaPenjual => ({
  rows: [], karyawan: [], namaKaryawan: new Map(), cabangOptions: [], faktur: [],
  selisihDokumen: 0, returTanpaSumber: 0, pesanError,
});

type EmpRow = { id: string; nama: string; jabatan: string | null; status: string | null; profile_id: string | null; branches: Rel<{ name: string }> };

const pilihanKaryawan = (rows: EmpRow[], munculDiData: Set<string>): PilihanKaryawanPenjual[] => rows
  .filter((e) => (e.status ?? "").toLocaleLowerCase("id-ID") === "aktif" || munculDiData.has(e.id))
  .map((e) => ({ id: e.id, nama: e.nama, jabatan: e.jabatan, branchName: one(e.branches)?.name ?? null }))
  .sort((a, b) => a.nama.localeCompare(b.nama, "id") || a.id.localeCompare(b.id));

type InvoiceInduk = NonNullable<Exclude<InvoiceItemRow["invoices"], unknown[]>>;
type SaleInduk = NonNullable<Exclude<SaleItemRow["sales"], unknown[]>>;
type FakturInduk = NonNullable<Exclude<GrosirItemRow["sales_invoices"], unknown[]>>;

/**
 * Tiga sumber baris dibaca dengan pola yang sama: dokumen induk (invoice/struk/faktur) sekali, lalu item per
 * kelompok 100 id induk bersamaan. Dulu satu query gabungan item x induk per halaman 500 yang menghitung ulang
 * seluruh gabungan + cek akses cabang per baris tiap halaman (±3-6 dtk per query, 30+ query). Hasil sama dengan gabungan lama.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bacaItemKlinik(supabase: any, mulai: string, akhir: string, cabangId: string): Promise<InvoiceItemRow[]> {
  const invoices = await readReportRows<InvoiceInduk>(async (awal, ujung) => {
    const query = supabase.from("invoices")
      .select(`id, visit_id, invoice_no, created_at, total, salesperson_id, voided_at, visits${cabangId ? "!inner" : ""}(branch_id, doctor_id, branches(name), customers(name), pets(name))`, { count: "exact" })
      .is("voided_at", null)
      .gte("created_at", mulai).lte("created_at", akhir);
    const { data, error, count } = await (cabangId ? query.eq("visits.branch_id", cabangId) : query)
      .order("id").range(awal, ujung);
    return { data: data as unknown as InvoiceInduk[] | null, error, count };
  }, undefined, { paralel: BATAS_BACA_LAPORAN });
  const perId = new Map(invoices.map(invoice => [invoice.id, invoice] as const));
  const item = await bacaAnakPerInduk<InvoiceItemRow & { invoice_id: string }>(perId.keys(), async (batch, awal, ujung) => {
    const { data, error, count } = await supabase.from("invoice_items")
      .select("id, invoice_id, deskripsi, qty, harga, jenis, diskon_persen, item_id, compound_recipe_id, service_performers, salesperson_id", { count: "exact" })
      .in("invoice_id", batch).order("id").range(awal, ujung);
    return { data: data as unknown as (InvoiceItemRow & { invoice_id: string })[] | null, error, count };
  });
  return item.map(({ invoice_id: invoiceId, ...baris }) => {
    const invoice = perId.get(invoiceId);
    if (!invoice) throw new Error("Invoice sumber baris laporan tidak dapat diverifikasi.");
    return { ...baris, invoices: invoice } as InvoiceItemRow;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bacaItemKasir(supabase: any, dari: string, sampai: string, mulai: string, akhir: string, cabangId: string): Promise<SaleItemRow[]> {
  // Jalur utama: satu fungsi baca-saja di database per rentang 7 hari (migrasi 20261202200000, hak baca sama dengan RLS).
  const cepat = await bacaStrukKasirCepat(supabase, { dari, sampai, cabangId });
  if (cepat) {
    const perStruk = new Map(cepat.sales.map(s => [s.id, {
      id: s.id, branch_id: s.branch_id, no_struk: s.no_struk, created_at: s.created_at, total: s.total,
      merchant_fee_total: s.merchant_fee_total, salesperson_id: s.salesperson_id, cashier_id: s.cashier_id,
      payment_plan: s.payment_plan, payments_finalized_at: s.payments_finalized_at, voided_at: s.voided_at,
      branches: s.branches, customers: s.customers,
    } as unknown as SaleInduk] as const));
    return cepat.items.map(i => {
      const sale = perStruk.get(i.sale_id);
      if (!sale) throw new Error("Struk sumber baris laporan tidak dapat diverifikasi.");
      return {
        id: i.id, nama: i.nama, qty: i.qty, harga: i.harga, item_id: i.item_id, satuan: i.satuan, faktor: i.faktor,
        item_discount_type: i.item_discount_type, item_discount_value: i.item_discount_value, promo_discount: i.promo_discount,
        service_performers: i.service_performers as ServicePerformersSnapshot | null, sales: sale,
      } as SaleItemRow;
    });
  }
  const struk = await readReportRows<SaleInduk>(async (awal, ujung) => {
    const query = supabase.from("sales")
      .select("id, branch_id, no_struk, created_at, total, merchant_fee_total, salesperson_id, cashier_id, payment_plan, payments_finalized_at, voided_at, branches(name), customers(name)", { count: "exact" })
      .gte("created_at", mulai).lte("created_at", akhir);
    const { data, error, count } = await (cabangId ? query.eq("branch_id", cabangId) : query)
      .order("id").range(awal, ujung);
    return { data: data as unknown as SaleInduk[] | null, error, count };
  }, undefined, { paralel: BATAS_BACA_LAPORAN });
  const perId = new Map(struk.map(sale => [sale.id, sale] as const));
  const item = await bacaAnakPerInduk<SaleItemRow & { sale_id: string }>(perId.keys(), async (batch, awal, ujung) => {
    const { data, error, count } = await supabase.from("sale_items")
      .select("id, sale_id, nama, qty, harga, item_id, satuan, faktor, item_discount_type, item_discount_value, promo_discount, service_performers", { count: "exact" })
      .in("sale_id", batch).order("id").range(awal, ujung);
    return { data: data as unknown as (SaleItemRow & { sale_id: string })[] | null, error, count };
  });
  return item.map(({ sale_id: saleId, ...baris }) => {
    const sale = perId.get(saleId);
    if (!sale) throw new Error("Struk sumber baris laporan tidak dapat diverifikasi.");
    return { ...baris, sales: sale } as SaleItemRow;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bacaItemGrosir(supabase: any, dari: string, sampai: string, cabangId: string): Promise<GrosirItemRow[]> {
  const faktur = await readReportRows<FakturInduk>(async (awal, ujung) => {
    const query = supabase.from("sales_invoices")
      .select(`${SELECT_FAKTUR_GROSIR}, created_by, sales_orders(salesperson_id), branches(name), customers(name)`, { count: "exact" })
      .gte("tanggal", dari).lte("tanggal", sampai);
    const { data, error, count } = await (cabangId ? query.eq("branch_id", cabangId) : query)
      .order("id").range(awal, ujung);
    return { data: data as unknown as FakturInduk[] | null, error, count };
  }, undefined, { paralel: BATAS_BACA_LAPORAN });
  const perId = new Map(faktur.map(f => [f.id, f] as const));
  const item = await bacaAnakPerInduk<GrosirItemRow & { invoice_id: string }>(perId.keys(), async (batch, awal, ujung) => {
    const { data, error, count } = await supabase.from("sales_invoice_items")
      .select("id, invoice_id, nama, qty, harga, diskon, item_id, satuan", { count: "exact" })
      .in("invoice_id", batch).order("id").range(awal, ujung);
    return { data: data as unknown as (GrosirItemRow & { invoice_id: string })[] | null, error, count };
  });
  return item.map(({ invoice_id: fakturId, ...baris }) => {
    const f = perId.get(fakturId);
    if (!f) throw new Error("Faktur grosir sumber baris laporan tidak dapat diverifikasi.");
    return { ...baris, sales_invoices: f } as GrosirItemRow;
  });
}

export type OpsiFilterPenjual = Pick<DataTenagaPenjual, "karyawan" | "namaKaryawan" | "cabangOptions" | "pesanError">;

/**
 * A1 (meeting 12 Nov 2026): hanya isian filter (cabang + karyawan), tanpa baris
 * penjualan. Dipakai saat laporan dibuka tetapi Tampilkan belum ditekan.
 */
export async function ambilOpsiFilterPenjual(): Promise<OpsiFilterPenjual> {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const [diizinkan, karyawanRows, cabangRows] = await Promise.all([
      auth?.user ? allowedBranchIds(supabase, auth.user.id) : Promise.resolve([] as string[]),
      completeReportQuery(supabase.from("employees")
        .select("id, nama, jabatan, status, profile_id, branches!employees_branch_id_fkey(name)", { count: "exact" })),
      completeReportQuery(supabase.from("branches").select("id, name", { count: "exact" }).eq("is_active", true)),
    ]);
    const semuaKaryawan = (karyawanRows.data ?? []) as unknown as EmpRow[];
    return {
      karyawan: pilihanKaryawan(semuaKaryawan, new Set()),
      namaKaryawan: new Map(semuaKaryawan.map((e) => [e.id, e.nama])),
      cabangOptions: ((cabangRows.data ?? []) as { id: string; name: string }[])
        .filter((cabang) => diizinkan === null || diizinkan.includes(cabang.id))
        .sort((a, b) => a.name.localeCompare(b.name, "id")),
      pesanError: "",
    };
  } catch (error) {
    console.error("Pilihan filter laporan penjualan per tenaga penjual gagal:", error);
    return { karyawan: [], namaKaryawan: new Map(), cabangOptions: [], pesanError: "Pilihan filter belum bisa dibaca. Muat ulang halaman." };
  }
}

export async function ambilTenagaPenjual({ dari, sampai, cabangId = "" }: {
  dari: string; sampai: string;
  /** Kosong = semua cabang yang boleh diakses. Diisi = disaring langsung di query (A1). */
  cabangId?: string;
}): Promise<DataTenagaPenjual> {
  if (!tanggalValid(dari) || !tanggalValid(sampai) || dari > sampai) {
    return kosong("Rentang tanggal tidak valid. Periksa tanggal awal dan akhir.");
  }
  const { mulai, akhir } = batasTanggalWIB(dari, sampai);
  const rows: BarisPenjual[] = [];
  let selisihDokumen = 0;
  let returTanpaSumber = 0;

  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const diizinkan = auth?.user ? await allowedBranchIds(supabase, auth.user.id) : [];

    const [invoiceItems, saleItems, grosirItems, karyawanRows, cabangRows] = await Promise.all([
      bacaItemKlinik(supabase, mulai, akhir, cabangId),
      bacaItemKasir(supabase, dari, sampai, mulai, akhir, cabangId),
      bacaItemGrosir(supabase, dari, sampai, cabangId),
      completeReportQuery(supabase.from("employees")
        .select("id, nama, jabatan, status, profile_id, branches!employees_branch_id_fkey(name)", { count: "exact" })),
      completeReportQuery(supabase.from("branches").select("id, name", { count: "exact" }).eq("is_active", true)),
    ]);

    const semuaKaryawan = (karyawanRows.data ?? []) as unknown as EmpRow[];
    const namaKaryawan = new Map(semuaKaryawan.map((e) => [e.id, e.nama]));
    const empPerProfile = new Map(semuaKaryawan.filter((e) => e.profile_id).map((e) => [e.profile_id as string, e.id]));

    // ── Klinik ────────────────────────────────────────────────────────────────
    const barisPerInvoice = new Map<string, InvoiceItemRow[]>();
    for (const item of invoiceItems) {
      const invoice = one(item.invoices);
      if (!invoice?.id) throw new Error("Invoice sumber baris laporan tidak dapat diverifikasi.");
      barisPerInvoice.set(invoice.id, [...(barisPerInvoice.get(invoice.id) ?? []), item]);
    }
    // Hanya kunjungan yang punya baris tanpa tautan racikan/barang yang perlu dicocokkan dengan resepnya (lihat perluCocokNamaRacikan).
    const namaRacikan = await namaRacikanPerKunjungan(supabase, invoiceItems.filter(perluCocokNamaRacikan)
      .map((item) => one(item.invoices)?.visit_id ?? "").filter(Boolean));

    const netoKlinik = new Map<string, number>();
    const barisKlinikPerId = new Map<string, BarisPenjual>();
    const qtyAsalKlinik = new Map<string, number>();
    for (const items of barisPerInvoice.values()) {
      const invoice = one(items[0].invoices)!;
      // Diskon BARIS mengurangi baris itu saja. Kalau dasarnya memakai harga kotor,
      // potongan khusus satu baris ikut dibagi ke baris pelaksana lain — kontribusi
      // per dokter/penjual jadi berbeda dari laporan Penjualan per Barang. Hanya
      // potongan tingkat DOKUMEN yang dialokasikan proporsional, setelah diskon baris.
      //
      // Catatan: `komisi-data.ts` masih memakai dasar kotor. Menyamakannya mengubah
      // NILAI KOMISI yang dibayarkan ke karyawan, jadi perubahannya butuh keputusan
      // pemilik dan dikerjakan terpisah dari mitigasi audit ini.
      const dasar = items.map((item) => {
        const persen = Math.min(100, Math.max(0, Number(item.diskon_persen) || 0));
        return (Number(item.qty) || 0) * (Number(item.harga) || 0) * (1 - persen / 100);
      });
      const neto = alokasiPotonganDokumen(dasar, Number(invoice.total) || 0);
      items.forEach((item, index) => netoKlinik.set(item.id, neto[index]));
      selisihDokumen += Math.max(0, (Number(invoice.total) || 0) - dasar.reduce((a, b) => a + b, 0));
    }

    for (const item of invoiceItems) {
      const invoice = one(item.invoices)!;
      const visit = one(invoice.visits);
      // Dokumen tanpa atribusi per baris: isian "Penjual SKU" dulu, lalu dokter PJ kunjungan.
      const penjualLama = item.salesperson_id ?? invoice.salesperson_id ?? null;
      const performers = item.service_performers;
      const jenis: JenisBarisPenjualan = item.deskripsi === BIAYA_ADMIN_DEMO && !item.item_id
        ? "Biaya Admin" : jenisBarisKlinik(item, invoice.visit_id, namaRacikan);
      const qty = Number(item.qty) || 0;
      const baris: BarisPenjual = {
        id: `klinik-${item.id}`,
        dokumenId: invoice.id,
        dokumen: invoice.invoice_no ?? "—",
        href: hrefInvoiceKlinik(invoice.visit_id, invoice.id),
        waktu: invoice.created_at,
        tanggal: tanggalWIB(invoice.created_at),
        kanal: "Klinik",
        jenis,
        cabangId: visit?.branch_id ?? null,
        cabang: one(visit?.branches ?? null)?.name ?? "—",
        pelanggan: one(visit?.customers ?? null)?.name ?? "—",
        pasien: one(visit?.pets ?? null)?.name ?? "—",
        item: item.deskripsi,
        qty,
        bruto: qty * (Number(item.harga) || 0),
        netto: netoKlinik.get(item.id) ?? 0,
        dokterId: performers ? performers.doctor_id ?? null : penjualLama ? null : visit?.doctor_id ?? null,
        stafId: performers ? performers.staff_id ?? null : null,
        penjualId: performers ? null : penjualLama,
        retur: false,
        itemId: item.item_id ?? null,
        namaItem: item.deskripsi,
        satuan: null,
      };
      rows.push(baris);
      barisKlinikPerId.set(item.id, baris);
      qtyAsalKlinik.set(item.id, qty);
    }

    // ── Petshop / kasir ───────────────────────────────────────────────────────
    const barisPerStruk = new Map<string, SaleItemRow[]>();
    for (const item of saleItems) {
      const sale = one(item.sales);
      if (!sale?.id || !isCompletedSale(sale)) continue;
      barisPerStruk.set(sale.id, [...(barisPerStruk.get(sale.id) ?? []), item]);
    }
    const netoKasir = new Map<string, number>();
    const strukPer = new Map<string, SaleRel>();
    const barisKasirPerId = new Map<string, BarisPenjual>();
    /** Faktor satuan baris struk: qty dasar = qty × faktor. */
    const faktorKasir = new Map<string, number>();
    for (const items of barisPerStruk.values()) {
      const sale = one(items[0].sales)!;
      strukPer.set(sale.id, sale);
      const subtotal = items.map((item) => lineSubtotal({
        qty: Number(item.qty) || 0, harga: Number(item.harga) || 0,
        item_discount_type: item.item_discount_type, item_discount_value: item.item_discount_value,
        promo_discount: item.promo_discount,
      }));
      const neto = alokasiPotonganDokumen(subtotal, saleMerchandiseTotal(sale));
      items.forEach((item, index) => netoKasir.set(item.id, neto[index]));
      selisihDokumen += Math.max(0, saleMerchandiseTotal(sale) - subtotal.reduce((a, b) => a + b, 0));
    }

    const penjualStruk = (sale: SaleRel): string | null =>
      sale.salesperson_id ?? (sale.cashier_id ? empPerProfile.get(sale.cashier_id) ?? null : null);

    for (const item of saleItems) {
      const sale = one(item.sales);
      if (!sale?.id || !isCompletedSale(sale)) continue;
      const performers = item.service_performers;
      const qty = Number(item.qty) || 0;
      const baris: BarisPenjual = {
        id: `kasir-${item.id}`,
        dokumenId: sale.id,
        dokumen: sale.no_struk ?? "—",
        href: `/penjualan/${sale.id}`,
        waktu: sale.created_at,
        tanggal: tanggalWIB(sale.created_at),
        kanal: "Petshop",
        jenis: "Barang",
        cabangId: sale.branch_id ?? null,
        cabang: one(sale.branches)?.name ?? "—",
        pelanggan: one(sale.customers)?.name ?? "Umum",
        pasien: "—",
        item: item.nama,
        qty,
        bruto: qty * (Number(item.harga) || 0),
        netto: netoKasir.get(item.id) ?? 0,
        dokterId: performers?.doctor_id ?? null,
        stafId: performers?.staff_id ?? null,
        penjualId: performers ? null : penjualStruk(sale),
        retur: false,
        itemId: item.item_id ?? null,
        namaItem: item.nama,
        satuan: item.satuan ?? null,
      };
      rows.push(baris);
      barisKasirPerId.set(item.id, baris);
      faktorKasir.set(item.id, Number(item.faktor) || 1);
    }

    // ── Retur kasir: mengurangi omzet orang yang menjual baris aslinya ─────────
    // Returnya dikurangkan dari struk asalnya berapa pun tanggal returnya, sama
    // seperti Rincian Penjualan per Transaksi.
    const strukIds = [...strukPer.keys()];
    const returs: ReturRow[] = [];
    // Kelompok id struk dibaca bersamaan (dulu satu per satu: ±1 query per 100 struk berurutan); urutan hasil tetap per kelompok.
    const kelompokRetur = await petaBerbatas(potong(strukIds), BATAS_BACA_LAPORAN, async batch => {
      const { data } = await completeReportQuery(supabase.from("sales_returns")
        .select("id, sale_id, tanggal, sales_return_items(id, source_line_id, nama, qty, harga, selected_qty, satuan)", { count: "exact" })
        .is("voided_at", null).in("sale_id", batch));
      return (data ?? []) as unknown as ReturRow[];
    });
    returs.push(...kelompokRetur.flat());
    const performerAdaPerStruk = new Map<string, boolean>();
    for (const [saleId, items] of barisPerStruk) {
      performerAdaPerStruk.set(saleId, items.some((item) => item.service_performers != null));
    }
    for (const retur of returs) {
      const sale = strukPer.get(retur.sale_id);
      if (!sale) continue;
      for (const item of retur.sales_return_items ?? []) {
        const qty = Number(item.qty) || 0;
        // Harga retur memuat fee merchant pelanggan; fee bukan omzet siapa pun.
        const kotor = new PosDecimal(qty).times(Number(item.harga) || 0);
        const nilai = Number(sale.merchant_fee_total) > 0 && Number(sale.total) > 0
          ? kotor.times(saleMerchandiseTotal(sale)).div(Number(sale.total)).toNumber() : kotor.toNumber();
        const asal = item.source_line_id ? barisKasirPerId.get(item.source_line_id) : undefined;
        const takPasti = !asal && performerAdaPerStruk.get(retur.sale_id) === true;
        // Qty retur tersimpan dalam satuan DASAR, sedangkan baris struk dalam satuan
        // jualnya. Dinyatakan dalam satuan baris asal supaya mengurangi qty yang sebanding.
        const qtySatuanAsal = !asal ? qty
          : item.selected_qty != null && (item.satuan ?? null) === (asal.satuan ?? null) ? Number(item.selected_qty) || 0
          : qty / (faktorKasir.get(item.source_line_id!) || 1);
        if (takPasti) returTanpaSumber += nilai;
        rows.push({
          id: `retur-${item.id}`,
          dokumenId: sale.id,
          dokumen: sale.no_struk ?? "—",
          href: `/penjualan/${sale.id}`,
          waktu: `${retur.tanggal}T00:00:00+07:00`,
          tanggal: retur.tanggal,
          kanal: "Petshop",
          jenis: "Barang",
          cabangId: sale.branch_id ?? null,
          cabang: one(sale.branches)?.name ?? "—",
          pelanggan: one(sale.customers)?.name ?? "Umum",
          pasien: "—",
          item: `Retur · ${item.nama ?? asal?.item ?? "barang"}`,
          qty: -qtySatuanAsal,
          bruto: -nilai,
          netto: -nilai,
          // Baris retur yang sumbernya tidak pasti tidak ditebak pemiliknya.
          dokterId: asal?.dokterId ?? null,
          stafId: asal?.stafId ?? null,
          penjualId: asal ? asal.penjualId : takPasti ? null : penjualStruk(sale),
          retur: true,
          // Retur mewarisi identitas item asalnya (A2): qty retur mengurangi item yang sama.
          itemId: asal?.itemId ?? null,
          namaItem: asal?.namaItem ?? item.nama ?? "barang",
          satuan: asal ? asal.satuan ?? null : null,
        });
      }
    }

    // ── Refund klinik (J03): membalik porsi qty dari baris invoice aslinya ─────
    const invoiceIds = [...barisPerInvoice.keys()];
    const refunds: RefundRow[] = [];
    const kelompokRefund = await petaBerbatas(potong(invoiceIds), BATAS_BACA_LAPORAN, batch => readReportRows<RefundRow>(async (awal, ujung) => {
      const result = await supabase.from("clinic_refunds")
        .select("id, invoice_id, tanggal, clinic_refund_items(id, invoice_item_id, qty)", { count: "exact" })
        .in("invoice_id", batch).order("id").range(awal, ujung);
      if (result.error && TABEL_BELUM_ADA.has(result.error.code ?? "")) return { data: [], error: null, count: 0 };
      return { data: result.data as unknown as RefundRow[] | null, error: result.error, count: result.count };
    }));
    refunds.push(...kelompokRefund.flat());
    for (const refund of refunds) {
      for (const item of refund.clinic_refund_items ?? []) {
        const asal = barisKlinikPerId.get(item.invoice_item_id);
        const qtyAsal = qtyAsalKlinik.get(item.invoice_item_id) ?? 0;
        if (!asal || qtyAsal <= 0) continue;
        const porsi = (Number(item.qty) || 0) / qtyAsal;
        rows.push({
          ...asal,
          id: `refund-${item.id}`,
          waktu: `${refund.tanggal}T00:00:00+07:00`,
          tanggal: refund.tanggal,
          item: `Refund · ${asal.item}`,
          qty: -(Number(item.qty) || 0),
          bruto: -asal.bruto * porsi,
          netto: -asal.netto * porsi,
          retur: true,
        });
      }
    }

    // ── Grosir ────────────────────────────────────────────────────────────────
    // Penjual = tenaga penjual pilihan di pesanan dasarnya, atau pembuat faktur bila kosong.
    const penjualFaktur = (faktur: FakturRel): string | null =>
      one(faktur.sales_orders ?? null)?.salesperson_id
      ?? (faktur.created_by ? empPerProfile.get(faktur.created_by) ?? null : null);
    const fakturPer = new Map<string, FakturRel>();
    for (const item of grosirItems) {
      const faktur = one(item.sales_invoices);
      if (!faktur?.id) throw new Error("Faktur grosir sumber baris laporan tidak dapat diverifikasi.");
      fakturPer.set(faktur.id, faktur);
    }
    const grosirDihitung = new Set(fakturGrosirOmzet([...fakturPer.values()]).map((faktur) => faktur.id));
    for (const item of grosirItems) {
      const faktur = one(item.sales_invoices)!;
      if (!grosirDihitung.has(faktur.id)) continue;
      const qty = Number(item.qty) || 0;
      rows.push({
        id: `grosir-${item.id}`,
        dokumenId: faktur.id,
        dokumen: faktur.no_faktur ?? "—",
        href: `/penjualan/faktur/${faktur.id}`,
        // Faktur hanya menyimpan tanggal, bukan jam; dipatok awal hari WIB.
        waktu: `${faktur.tanggal}T00:00:00+07:00`,
        tanggal: faktur.tanggal,
        kanal: "Grosir",
        jenis: "Barang",
        cabangId: faktur.branch_id ?? null,
        cabang: one(faktur.branches)?.name ?? "—",
        pelanggan: one(faktur.customers)?.name ?? "—",
        pasien: "—",
        item: item.nama,
        qty,
        bruto: qty * (Number(item.harga) || 0),
        netto: nilaiBarisGrosir(item),
        dokterId: null,
        stafId: null,
        penjualId: penjualFaktur(faktur),
        retur: false,
        itemId: item.item_id ?? null,
        namaItem: item.nama,
        satuan: item.satuan ?? null,
      });
    }

    // ── Sisa tagihan faktur grosir per penjual ────────────────────────────────
    const fakturDihitung = [...fakturPer.values()].filter((faktur) => grosirDihitung.has(faktur.id));
    const nilaiFaktur = new Map<string, { no_faktur: string | null; tanggal: string; total: number; carried_paid: number; created_by: string | null }>();
    for (const batch of potong(fakturDihitung.map((faktur) => faktur.id))) {
      const { data } = await completeReportQuery(supabase.from("sales_invoices")
        .select("id, no_faktur, tanggal, total, carried_paid, created_by", { count: "exact" }).in("id", batch));
      for (const row of (data ?? []) as { id: string; no_faktur: string | null; tanggal: string; total: number; carried_paid: number; created_by: string | null }[]) {
        nilaiFaktur.set(row.id, row);
      }
    }
    const dibayarPer = new Map<string, number>();
    for (const batch of potong([...nilaiFaktur.keys()])) {
      const { data } = await completeReportQuery(supabase.from("sales_receipts")
        .select("id, invoice_id, jumlah", { count: "exact" }).in("invoice_id", batch));
      for (const row of (data ?? []) as { invoice_id: string; jumlah: number }[]) {
        dibayarPer.set(row.invoice_id, (dibayarPer.get(row.invoice_id) ?? 0) + (Number(row.jumlah) || 0));
      }
    }
    const fakturCabang = new Map(fakturDihitung.map((faktur) => [faktur.id, faktur.branch_id ?? null]));
    const faktur: FakturBelumLunas[] = [...nilaiFaktur.entries()]
      .filter(([id]) => diizinkan === null || diizinkan.includes(fakturCabang.get(id) ?? ""))
      .map(([id, row]) => {
        const dibayar = (Number(row.carried_paid) || 0) + (dibayarPer.get(id) ?? 0);
        return {
          id, no_faktur: row.no_faktur ?? "—", tanggal: row.tanggal,
          penjualId: fakturPer.has(id) ? penjualFaktur(fakturPer.get(id)!) : row.created_by ? empPerProfile.get(row.created_by) ?? null : null,
          nilai: Number(row.total) || 0, dibayar, sisa: Math.max(0, (Number(row.total) || 0) - dibayar),
        };
      })
      .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.no_faktur.localeCompare(b.no_faktur));

    // Akses cabang: baris cabang lain tidak pernah sampai ke layar maupun unduhan.
    const terlihat = diizinkan === null ? rows : rows.filter((row) => row.cabangId && diizinkan.includes(row.cabangId));

    // Kode barang master untuk Rekap per item (A2). Murni keterangan: gagal dibaca = kode kosong.
    const kodePerItem = await bacaKodeBarang(supabase, terlihat.map((row) => row.itemId));
    for (const row of terlihat) if (row.itemId) row.kode = kodePerItem.get(row.itemId) ?? "";
    const munculDiData = new Set(terlihat.flatMap((row) =>
      [row.dokterId, row.stafId, row.penjualId].filter((id): id is string => !!id)));
    const cabangTerlihat = (cabangRows.data ?? []) as { id: string; name: string }[];
    return {
      rows: terlihat,
      // Pemilih karyawan: yang masih aktif, ditambah siapa pun yang muncul di data
      // rentang ini supaya penjual yang sudah keluar tetap bisa disaring.
      karyawan: pilihanKaryawan(semuaKaryawan, munculDiData),
      namaKaryawan,
      cabangOptions: cabangTerlihat
        .filter((cabang) => diizinkan === null || diizinkan.includes(cabang.id))
        .sort((a, b) => a.name.localeCompare(b.name, "id")),
      faktur,
      selisihDokumen,
      returTanpaSumber,
      pesanError: "",
    };
  } catch (error) {
    console.error("Laporan penjualan per tenaga penjual gagal:", error);
    const galat = klasifikasiGalatLaporan(error);
    return kosong(galat.kode === "periode" ? galat.pesan
      : galat.kode === "umum" ? "Laporan belum bisa dibaca. Coba lagi atau pilih rentang tanggal lebih pendek." : galat.pesan);
  }
}
