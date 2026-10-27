import { completeReportQuery } from "./report-query";
import { readReportRows } from "./hpp-reports-server";
import { isCompletedSale, saleMerchandiseTotal, type SaleCompletion, type SaleMerchantTotal } from "./sale-payment-reporting";
import { PosDecimal } from "./pos-money";
import type { ServicePerformersSnapshot } from "./service-performers";
import { prepareServiceCommission, type ServiceCommissionPolicy } from "./service-commission-policy";
// Pengumpul data komisi: menarik penjualan + retur satu periode lalu menyusunnya
// jadi baris siap hitung untuk `hitungKomisi`.
//
// Dipisah dari layar supaya layar komisi, layar target, dan penggajian memakai
// sumber angka yang sama persis.

import { lineSubtotal } from "./pos-calc";
import { tanggalWIB } from "./tanggal";
import { barisVisitRanap, mergeSharedIncentives, hitungKomisi, peringatanAturanKomisi, ringkasPaket, type AturanKomisi, type BarisJual, type HasilKomisi, type LogVisitDokter, type VisitDobel } from "./komisi";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export const awalPeriode = (periode: string) => `${periode}-01`;

/**
 * One Asia/Jakarta (UTC+7, no DST) boundary for every timestamp period filter: struk kasir,
 * pelunasan klinik, visit ranap, pool DEMO. A sale at 00:30 WIB on the 1st belongs to that month.
 */
export const batasWIB = (periode: string) => ({
  dari: `${awalPeriode(periode)}T00:00:00+07:00`,
  sampai: `${akhirPeriode(periode)}T23:59:59.999+07:00`,
});

export const akhirPeriode = (periode: string): string => {
  const [thn, bln] = periode.split("-").map(Number);
  return `${periode}-${String(new Date(thn, bln, 0).getDate()).padStart(2, "0")}`;
};

type SaleItemRow = {
  id?: string;
  service_performers?: ServicePerformersSnapshot | null;
  item_id: string | null;
  qty: number;
  harga: number;
  item_discount_type: "nominal" | "percent" | null;
  item_discount_value: number | null;
  hpp: number | null;
};

type SaleRow = SaleCompletion & SaleMerchantTotal & {
  no_struk?: string;
  id: string;
  created_at: string;
  branch_id: string | null;
  cashier_id: string | null;
  salesperson_id: string | null;
  total: number;
  sale_items: SaleItemRow[] | null;
};

type ReturRow = {
  sale_id: string;
  tanggal: string;
  sales_return_items: { source_line_id?: string | null; item_id: string | null; qty: number; harga: number }[] | null;
};

type InvoiceRow = {
  invoice_no?: string;
  visit_id?: string;
  id: string;
  paid_at: string;
  clinic_demo_invoice_snapshots?: {invoice_id:string} | {invoice_id:string}[] | null;
  total: number;
  salesperson_id: string | null;
  visits: { branch_id: string | null; doctor_id: string | null } | { branch_id: string | null; doctor_id: string | null }[] | null;
  invoice_items: { id?: string;service_performers?: ServicePerformersSnapshot | null;salesperson_id?: string | null;item_id: string | null; qty: number; harga: number; hpp: number | null;
    package_item_id?: string | null; package_qty?: number | string | null }[] | null;
};

type SourceAttribution = Pick<BarisJual,"employeeId"|"servicePerformers"|"sourceLineId"|"sourceDocumentId"|"sourceDocumentNumber"|"sourceDocumentHref"|"commissionPending">;
function serviceAttribution(row:{id?:string;service_performers?:ServicePerformersSnapshot|null},legacy:string|null,documentId:string,number?:string,href?:string):SourceAttribution {
  if(row.service_performers==null)return {employeeId:legacy};
  const ids=[...new Set([row.service_performers.doctor_id,row.service_performers.staff_id].filter((id):id is string=>!!id))];
  // Pending two-person policy is never replaced with a guessed split or two global payouts.
  return {employeeId:ids.length===1?ids[0]:null,commissionPending:ids.length>1,servicePerformers:row.service_performers,
    sourceLineId:row.id,sourceDocumentId:documentId,sourceDocumentNumber:number,sourceDocumentHref:href};
}
type SaleInfo={employeeId:string|null;branchId:string|null;hppPerUnit:Map<string,number>;sale:SaleMerchantTotal;lines:SaleItemRow[];documentId:string;number?:string;sourceDate:string};

type FakturJualRow = {
  id: string;
  tanggal: string;
  dpp: number;
  branch_id: string | null;
  created_by: string | null;
  sales_invoice_items: { order_item_id: string | null; item_id: string | null; qty: number; harga: number }[] | null;
};

export type DataKomisi = {
  baris: BarisJual[];
  /** Omzet yang tidak bisa dibagikan ke siapa pun (kasir/dokternya belum terhubung ke data karyawan). */
  omzetTanpaPenjual: number;
};

/** Rantai kategori sebuah barang: kategorinya sendiri + induknya (kategori 2 tingkat, migrasi 0066). */
function rantaiKategori(catId: string | null, indukPer: Map<string, string | null>): string[] {
  const out: string[] = [];
  let cur = catId;
  // Batas kedalaman menjaga dari data kategori yang tanpa sengaja melingkar.
  for (let i = 0; cur && i < 5; i++) {
    out.push(cur);
    cur = indukPer.get(cur) ?? null;
  }
  return out;
}

export async function kumpulkanBarisKomisi(supabase: AnyClient, periode: string): Promise<DataKomisi> {
  const awal = awalPeriode(periode);
  const akhir = akhirPeriode(periode);

  const [{ data: salesData }, { data: empData }, { data: itemData }, { data: katData }] = await Promise.all([
    completeReportQuery(supabase.from("sales")
      .select("id, no_struk, created_at, branch_id, cashier_id, salesperson_id, total, merchant_fee_total, payment_plan, payments_finalized_at, voided_at, sale_items(id, item_id, qty, harga, item_discount_type, item_discount_value, hpp, service_performers)", { count: "exact" })
      .gte("created_at", batasWIB(periode).dari).lte("created_at", batasWIB(periode).sampai)),
    completeReportQuery(supabase.from("employees").select("id, profile_id", { count: "exact" }).not("profile_id", "is", null)),
    completeReportQuery(supabase.from("items").select("id, category_id", { count: "exact" })),
    completeReportQuery(supabase.from("item_categories").select("id, parent_id", { count: "exact" })),
  ]);

  const sales = ((salesData ?? []) as SaleRow[]).filter(isCompletedSale);
  const empPerProfile = new Map(
    ((empData ?? []) as { id: string; profile_id: string }[]).map((e) => [e.profile_id, e.id]),
  );
  const katPerItem = new Map(
    ((itemData ?? []) as { id: string; category_id: string | null }[]).map((i) => [i.id, i.category_id]),
  );
  const indukPerKat = new Map(
    ((katData ?? []) as { id: string; parent_id: string | null }[]).map((k) => [k.id, k.parent_id]),
  );

  const baris: BarisJual[] = [];
  let omzetTanpaPenjual = 0;

  // Untuk baris retur: modal & pemilik struk asli.
  const infoStruk = new Map<string,SaleInfo>();

  for (const s of sales) {
    const employeeId = s.salesperson_id ?? (s.cashier_id ? empPerProfile.get(s.cashier_id) ?? null : null);
    const items = s.sale_items ?? [];

    const subtotalPer = items.map((it) => lineSubtotal({
      qty: Number(it.qty),
      harga: Number(it.harga),
      item_discount_type: it.item_discount_type,
      item_discount_value: Number(it.item_discount_value ?? 0),
    }));
    const jumlahBaris = subtotalPer.reduce((a, v) => a + v, 0);

    // Potongan tingkat struk (voucher, poin, diskon golongan, diskon manual kasir) tidak
    // tersimpan per baris. Selisih antara jumlah baris dan total struk dibagi rata secara
    // proporsional supaya komisi tidak dihitung dari harga sebelum potongan.
    const potonganStruk = Math.max(0, jumlahBaris - saleMerchandiseTotal(s));

    const hppPerUnit = new Map<string, number>();
    for (const [idx, it] of items.entries()) {
      const qty = Number(it.qty);
      if (it.item_id && it.hpp !== null && qty > 0) hppPerUnit.set(it.item_id, Number(it.hpp) / qty);

      const kotor = subtotalPer[idx];
      const omzet = jumlahBaris > 0 ? kotor - (potonganStruk * kotor) / jumlahBaris : kotor;
      const attribution=serviceAttribution(it,employeeId,s.id,s.no_struk,`/penjualan/${s.id}`);
      if (!attribution.employeeId) omzetTanpaPenjual += omzet;

      // Baris tanpa penjual tetap dibawa: realisasi target per cabang/kategori
      // tidak boleh kehilangan omzet cuma karena kasirnya belum terhubung ke
      // data karyawan. `hitungKomisi` yang menyaringnya.
      baris.push({
        tanggal: tanggalWIB(s.created_at),
        sumber: "kasir",
        ...attribution,
        branchId: s.branch_id,
        itemId: it.item_id,
        kategoriIds: rantaiKategori(it.item_id ? katPerItem.get(it.item_id) ?? null : null, indukPerKat),
        qty,
        omzet,
        laba: it.hpp === null ? null : omzet - Number(it.hpp),
      });
    }

    infoStruk.set(s.id, { employeeId, branchId: s.branch_id, hppPerUnit, sale: s,lines:items,documentId:s.id,number:s.no_struk,sourceDate:tanggalWIB(s.created_at) });
  }

  // ── Retur: mengurangi komisi orang yang menjualnya, di bulan returnya terjadi ──
  const { data: returData } = await completeReportQuery(supabase
    .from("sales_returns")
    .select("id, sale_id, tanggal, sales_return_items(source_line_id, item_id, qty, harga)", { count: "exact" }).is("voided_at", null)
    .gte("tanggal", awal).lte("tanggal", akhir));

  for (const r of (returData ?? []) as ReturRow[]) {
    const asal = infoStruk.get(r.sale_id);
    // Struk asalnya di luar periode ini — ambil pemiliknya langsung dari struk itu.
    const info = asal ?? (await infoStrukLuarPeriode(supabase, r.sale_id, empPerProfile));
    if (!info) continue;
    for (const it of r.sales_return_items ?? []) {
      const qty = Number(it.qty);
      // Return prices contain the customer's fee too; it never belongs to a seller's base.
      const gross = new PosDecimal(qty).times(it.harga);
      const nilai = Number(info.sale.merchant_fee_total) > 0 && Number(info.sale.total) > 0
        ? gross.times(saleMerchandiseTotal(info.sale)).div(info.sale.total).toNumber() : gross.toNumber();
      const source=it.source_line_id?info.lines.find(line=>line.id===it.source_line_id):undefined;
      const attribution:SourceAttribution=source?serviceAttribution(source,info.employeeId,info.documentId,info.number,`/penjualan/${info.documentId}`)
        :info.lines.some(line=>line.service_performers!=null)?{employeeId:null,commissionPending:true,sourceDocumentId:info.documentId,sourceDocumentNumber:info.number,sourceDocumentHref:`/penjualan/${info.documentId}`}:{employeeId:info.employeeId};
      if (!attribution.employeeId) omzetTanpaPenjual -= nilai;
      const hppUnit = source && source.hpp!==null && Number(source.qty)>0 ? Number(source.hpp)/Number(source.qty) : it.item_id ? info.hppPerUnit.get(it.item_id) : undefined;
      baris.push({
        tanggal: r.tanggal,
        commissionPolicyDate: info.sourceDate,
        sumber: "kasir",
        ...attribution,
        branchId: info.branchId,
        itemId: it.item_id,
        kategoriIds: rantaiKategori(it.item_id ? katPerItem.get(it.item_id) ?? null : null, indukPerKat),
        qty: -qty,
        omzet: -nilai,
        laba: hppUnit === undefined ? null : -(nilai - hppUnit * qty),
      });
    }
  }

  // ── Klinik: tagihan kunjungan yang sudah lunas, jadi haknya dokter ────────────
  // Dipatok pada tanggal bayar, bukan tanggal periksa: yang dikomisikan adalah uang
  // yang benar-benar masuk. Tagihan DP/belum lunas menyusul di bulan pelunasannya.
  const { data: invData } = await completeReportQuery(supabase
    .from("invoices")
    .select("id, invoice_no, visit_id, paid_at, total, salesperson_id, visits(branch_id, doctor_id), invoice_items(id, item_id, qty, harga, hpp, service_performers, salesperson_id, package_item_id, package_qty), clinic_demo_invoice_snapshots!clinic_demo_invoice_snapshots_invoice_id_fkey(invoice_id)", { count: "exact" })
    .eq("paid_status", "Lunas").is("voided_at", null)
    .gte("paid_at", batasWIB(periode).dari).lte("paid_at", batasWIB(periode).sampai));

  for (const inv of (invData ?? []) as InvoiceRow[]) {
    const v = Array.isArray(inv.visits) ? inv.visits[0] ?? null : inv.visits;
    const employeeId = inv.salesperson_id ?? v?.doctor_id ?? null;
    const items = inv.invoice_items ?? [];

    // Baris tagihan klinik tidak punya diskon per baris; potongannya cuma di kepala
    // tagihan, jadi dibagi proporsional seperti struk kasir.
    const kotorPer = items.map((it) => Number(it.qty) * Number(it.harga));
    const jumlahBaris = kotorPer.reduce((a, x) => a + x, 0);
    const potongan = Math.max(0, jumlahBaris - Number(inv.total));

    for (const [idx, it] of items.entries()) {
      const omzet = jumlahBaris > 0 ? kotorPer[idx] - (potongan * kotorPer[idx]) / jumlahBaris : kotorPer[idx];
      // A selected line seller overrides the legacy invoice seller. Existing
      // service performer attribution retains its precedence and payout policy.
      const href=inv.visit_id?`/klinik/pembayaran/${inv.visit_id}`:undefined;
      // H05: a package component is sold as the package (folded by ringkasPaket below).
      const paketAsal = it.package_item_id && Number(it.package_qty) > 0
        ? { itemId: it.package_item_id, qty: Number(it.package_qty), kategoriIds: rantaiKategori(katPerItem.get(it.package_item_id) ?? null, indukPerKat) }
        : undefined;
      // A package component keeps its own attribution, including a two-performer service split.
      const attribution=serviceAttribution(it,it.salesperson_id ?? employeeId,inv.id,inv.invoice_no,href);
      if (!attribution.employeeId) omzetTanpaPenjual += omzet;

      baris.push({
        tanggal: tanggalWIB(inv.paid_at),
        sumber: "klinik",
        fixedCommission: Array.isArray(inv.clinic_demo_invoice_snapshots) ? inv.clinic_demo_invoice_snapshots.length>0 : !!inv.clinic_demo_invoice_snapshots,
        ...attribution,
        ...(paketAsal ? { paketAsal } : {}),
        branchId: v?.branch_id ?? null,
        itemId: it.item_id,
        kategoriIds: rantaiKategori(it.item_id ? katPerItem.get(it.item_id) ?? null : null, indukPerKat),
        qty: Number(it.qty),
        omzet,
        // Jasa tidak punya modal barang — labanya utuh, bukan tidak diketahui.
        laba: it.item_id === null ? omzet : it.hpp === null ? null : omzet - Number(it.hpp),
      });
    }
  }

  // ── Reseller: faktur penjualan dari rantai dokumen (migrasi 0098) ─────────────
  // Dipatok pada tanggal faktur, bukan tanggal pelunasan seperti klinik: di sini
  // pendapatan diakui saat faktur terbit (Dr 1201 / Cr 4101), jadi omzet komisi,
  // realisasi target, dan omzet dashboard menunjuk angka yang sama. Faktur batal
  // tidak ikut. Yang dianggap penjualnya = pembuat faktur.
  const { data: fjData } = await completeReportQuery(supabase
    .from("sales_invoices")
    .select("id, tanggal, dpp, branch_id, created_by, sales_invoice_items(order_item_id, item_id, qty, harga)", { count: "exact" })
    .neq("status", "batal").is("opening_batch_id", null)
    .gte("tanggal", awal).lte("tanggal", akhir));

  const fakturs = (fjData ?? []) as FakturJualRow[];
  const hppPerOrderItem = await hppPengiriman(
    supabase,
    fakturs.flatMap((f) => (f.sales_invoice_items ?? []).map((it) => it.order_item_id).filter((x): x is string => !!x)),
  );

  for (const f of fakturs) {
    const employeeId = f.created_by ? empPerProfile.get(f.created_by) ?? null : null;
    const items = f.sales_invoice_items ?? [];

    // Baris faktur tidak punya diskon sendiri; potongan kepala faktur (kalau ada)
    // dibagi proporsional. Dasarnya DPP, bukan total — PPN bukan omzet penjual.
    const kotorPer = items.map((it) => Number(it.qty) * Number(it.harga));
    const jumlahBaris = kotorPer.reduce((a, x) => a + x, 0);
    const potongan = Math.max(0, jumlahBaris - Number(f.dpp));

    for (const [idx, it] of items.entries()) {
      const qty = Number(it.qty);
      const omzet = jumlahBaris > 0 ? kotorPer[idx] - (potongan * kotorPer[idx]) / jumlahBaris : kotorPer[idx];
      if (!employeeId) omzetTanpaPenjual += omzet;

      const hppUnit = it.order_item_id ? hppPerOrderItem.get(it.order_item_id) : undefined;
      baris.push({
        tanggal: f.tanggal,
        sumber: "reseller",
        employeeId,
        branchId: f.branch_id,
        itemId: it.item_id,
        kategoriIds: rantaiKategori(it.item_id ? katPerItem.get(it.item_id) ?? null : null, indukPerKat),
        qty,
        omzet,
        // Jasa (tanpa master barang) tidak punya modal — labanya utuh.
        laba: it.item_id === null ? omzet : hppUnit === undefined ? null : omzet - hppUnit * qty,
      });
    }
  }

  // H05: every reader (komisi, target, laporan penjual, payroll) sees a package as the
  // package — its component lines never reach anyone as normal SKU sales.
  return { baris: ringkasPaket(baris), omzetTanpaPenjual };
}

/**
 * Modal per unit tiap baris pesanan, diambil dari pengiriman yang sudah terjadi.
 * Faktur penjualan tidak menyimpan HPP — barangnya keluar di dokumen pengiriman,
 * dan di situlah modal FIFO-nya dicatat.
 */
async function hppPengiriman(supabase: AnyClient, orderItemIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(orderItemIds)];
  if (ids.length === 0) return out;

  const { data } = await completeReportQuery(supabase
    .from("sales_delivery_items")
    .select("id, order_item_id, qty, hpp", { count: "exact" })
    .in("order_item_id", ids));

  const akum = new Map<string, { qty: number; hpp: number }>();
  for (const d of (data ?? []) as { order_item_id: string | null; qty: number; hpp: number | null }[]) {
    if (!d.order_item_id || d.hpp === null) continue;
    const a = akum.get(d.order_item_id) ?? { qty: 0, hpp: 0 };
    a.qty += Number(d.qty);
    a.hpp += Number(d.hpp);
    akum.set(d.order_item_id, a);
  }
  for (const [id, a] of akum) if (a.qty > 0) out.set(id, a.hpp / a.qty);
  return out;
}

async function infoStrukLuarPeriode(
  supabase: AnyClient,
  saleId: string,
  empPerProfile: Map<string, string>,
): Promise<SaleInfo | null> {
  const { data } = await supabase
    .from("sales").select("id, no_struk, created_at, branch_id, cashier_id, salesperson_id, total, merchant_fee_total, payment_plan, payments_finalized_at, voided_at, sale_items(id, item_id, qty, hpp, service_performers)").eq("id", saleId).maybeSingle();
  if (!data || !isCompletedSale(data)) return null;
  const hppPerUnit = new Map<string, number>();
  for (const it of (data.sale_items ?? []) as { item_id: string | null; qty: number; hpp: number | null }[]) {
    if (it.item_id && it.hpp !== null && Number(it.qty) > 0) hppPerUnit.set(it.item_id, Number(it.hpp) / Number(it.qty));
  }
  return {
    employeeId: data.salesperson_id ?? (data.cashier_id ? empPerProfile.get(data.cashier_id) ?? null : null),
    branchId: data.branch_id,
    hppPerUnit,
    sale: data,
    lines:data.sale_items??[],documentId:saleId,number:data.no_struk,sourceDate:data.created_at?tanggalWIB(String(data.created_at)):"",
  };
}

export async function muatAturanKomisi(supabase: AnyClient): Promise<AturanKomisi[]> {
  const { data } = await completeReportQuery(supabase
    .from("commission_rules")
    .select("id, nama, tipe, basis, sumber, persen, nominal, employee_id, commission_group, override_group_rule_id, branch_id, category_id, item_id, min_omzet, berlaku_dari, berlaku_sampai", { count: "exact" })
    .eq("is_active", true)
    .order("nama"));

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    nama: String(r.nama),
    tipe: r.tipe as "persen" | "nominal",
    basis: r.basis as "omzet" | "laba",
    sumber: r.sumber as AturanKomisi["sumber"],
    persen: Number(r.persen),
    nominal: Number(r.nominal),
    employeeId: (r.employee_id as string | null) ?? null,
    commissionGroup: (r.commission_group as string | null) ?? null,
    overrideGroupRuleId: (r.override_group_rule_id as string | null) ?? null,
    branchId: (r.branch_id as string | null) ?? null,
    categoryId: (r.category_id as string | null) ?? null,
    itemId: (r.item_id as string | null) ?? null,
    minOmzet: Number(r.min_omzet),
    dari: (r.berlaku_dari as string | null) ?? null,
    sampai: (r.berlaku_sampai as string | null) ?? null,
  }));
}

/**
 * H06: doctor visit logs on inpatient stays in the period (by Asia/Jakarta calendar date).
 * The basis is visits done, not billed: no invoice is consulted.
 */
export async function muatVisitRanap(supabase: AnyClient, periode: string): Promise<{ baris: BarisJual[]; dobel: VisitDobel[] }> {
  type Row = { id: string; inpatient_record_id: string; visit_doctor_id: string | null; created_at: string;
    inpatient_records: { branch_id: string | null } | { branch_id: string | null }[] | null };
  const { data } = await completeReportQuery(supabase.from("inpatient_daily_logs")
    .select("id, inpatient_record_id, visit_doctor_id, created_at, inpatient_records(branch_id)", { count: "exact" })
    .eq("log_kind", "doctor_visit").not("visit_doctor_id", "is", null)
    .gte("created_at", batasWIB(periode).dari).lte("created_at", batasWIB(periode).sampai));
  const logs: LogVisitDokter[] = ((data ?? []) as Row[]).map((row) => {
    const record = Array.isArray(row.inpatient_records) ? row.inpatient_records[0] ?? null : row.inpatient_records;
    return { id: row.id, inpatientRecordId: row.inpatient_record_id, doctorId: row.visit_doctor_id,
      branchId: record?.branch_id ?? null, createdAt: row.created_at };
  });
  return barisVisitRanap(logs);
}

/** H04: configured commission group per employee. */
export async function muatKelompokKomisi(supabase: AnyClient): Promise<Map<string, string | null>> {
  const { data } = await completeReportQuery(supabase.from("employees").select("id, commission_group", { count: "exact" }));
  return new Map(((data ?? []) as { id: string; commission_group: string | null }[]).map((row) => [row.id, row.commission_group]));
}

/** H04: configuration that pays nothing (stale exception / empty group), for komisi & payroll screens. */
export async function muatPeringatanAturanKomisi(supabase: AnyClient): Promise<string[]> {
  const [aturan, groups, { data: emp }] = await Promise.all([
    muatAturanKomisi(supabase), muatKelompokKomisi(supabase),
    completeReportQuery(supabase.from("employees").select("id, nama", { count: "exact" })),
  ]);
  return peringatanAturanKomisi(aturan, groups, new Map(((emp ?? []) as { id: string; nama: string }[]).map((e) => [e.id, e.nama])));
}

/** Komisi seluruh karyawan untuk satu periode — dipakai layar komisi & penggajian. */
// PostgREST "table not found" and PostgreSQL "undefined table": only these mean the S04 migration is absent.
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);
class MissingServicePolicyTable extends Error {}

/**
 * Saved two-performer policies. Before the S04 migration is applied the table is absent: that reads as "no policy",
 * so two-performer rows stay pending and keep blocking payroll while every other row still calculates.
 * Any other read failure (auth, RLS error, incomplete page) stays fatal.
 */
export async function muatKebijakanKomisiJasa(supabase: AnyClient, sampai?: string):
  Promise<{ policies: ServiceCommissionPolicy[]; installed: boolean }> {
  type Row = { id: string; branch_id: string | null; effective_from: string; mode: string;
    doctor_share_pct: number | string | null; staff_share_pct: number | string | null; created_at: string };
  let rows: Row[];
  try {
    rows = await readReportRows<Row>(async (from, to) => {
      let query = supabase.from("service_commission_policies")
        .select("id,branch_id,effective_from,mode,doctor_share_pct,staff_share_pct,created_at", { count: "exact" });
      if (sampai) query = query.lte("effective_from", sampai);
      const result = await query.order("effective_from", { ascending: false }).order("created_at", { ascending: false })
        .order("id", { ascending: false }).range(from, to);
      if (MISSING_TABLE_CODES.has(result.error?.code)) throw new MissingServicePolicyTable();
      return { data: result.data, error: result.error, count: result.count };
    });
  } catch (error) {
    if (error instanceof MissingServicePolicyTable) return { policies: [], installed: false };
    throw error;
  }
  return { installed: true, policies: rows.map((row): ServiceCommissionPolicy => ({
    id: String(row.id), branchId: row.branch_id ?? null, effectiveFrom: String(row.effective_from),
    mode: row.mode as ServiceCommissionPolicy["mode"],
    doctorSharePct: row.doctor_share_pct === null ? null : Number(row.doctor_share_pct),
    staffSharePct: row.staff_share_pct === null ? null : Number(row.staff_share_pct), createdAt: String(row.created_at),
  })) };
}

export async function komisiPeriode(
  supabase: AnyClient,
  periode: string,
): Promise<{ hasil: HasilKomisi[]; baris: BarisJual[]; barisHitung: BarisJual[]; omzetTanpaPenjual: number; visitDobel: VisitDobel[]; peringatanAturan: string[] }> {
  const [{ baris: barisJual, omzetTanpaPenjual }, aturan, { policies }, visit, groups] = await Promise.all([
    kumpulkanBarisKomisi(supabase, periode),
    muatAturanKomisi(supabase),
    muatKebijakanKomisiJasa(supabase, akhirPeriode(periode)),
    muatVisitRanap(supabase, periode),
    muatKelompokKomisi(supabase),
  ]);
  // H06 visits are separate source rows that only visit rules can pay.
  const baris = [...barisJual, ...visit.baris];
  const prepared = prepareServiceCommission(baris, aturan, policies, groups);
  const {data: allocations} = await completeReportQuery(supabase.from("clinic_demo_incentive_allocations")
    .select("id,invoice_id,employee_id,amount,clinic_demo_invoice_snapshots!inner(service_basis),invoices!inner(paid_at,paid_status,voided_at)", {count:"exact"})
    .eq("invoices.paid_status","Lunas").is("invoices.voided_at",null)
    .gte("clinic_demo_invoice_snapshots.earned_at",batasWIB(periode).dari).lte("clinic_demo_invoice_snapshots.earned_at",batasWIB(periode).sampai));
  type Allocation = {invoice_id:string;employee_id:string;amount:number;clinic_demo_invoice_snapshots:{service_basis:number}|{service_basis:number}[]};
  const shared = (allocations as Allocation[]).map(row=>({employeeId:row.employee_id,invoiceId:row.invoice_id,amount:Number(row.amount),
    basis:Number((Array.isArray(row.clinic_demo_invoice_snapshots) ? row.clinic_demo_invoice_snapshots[0] : row.clinic_demo_invoice_snapshots).service_basis)}));
  return { hasil: mergeSharedIncentives(hitungKomisi(prepared.calculationRows, aturan, groups),shared),
    baris:prepared.rows, barisHitung:prepared.calculationRows,
    omzetTanpaPenjual:omzetTanpaPenjual-prepared.resolvedUnassignedOmzet, visitDobel: visit.dobel,
    peringatanAturan: peringatanAturanKomisi(aturan, groups) };
}
