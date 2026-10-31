import type { SupabaseClient } from "@supabase/supabase-js";
import Decimal from "decimal.js";
import { bolehBukaPath } from "./akses";
import { validReportDate } from "./hpp-reports";
import { readReportRows, ReportAccessError, ReportInputError } from "./hpp-reports-server";
import { hariIniWIB } from "./tanggal";

export const OPNAME_REPORT_PATH = "/laporan/hasil-opname";
export type OpnameReportParams = { dari?: string; sampai?: string; cabang?: string; order?: string; dasar?: string; arah?: string; halaman?: string };
export type OpnameFilters = { dari: string; sampai: string; cabang: string; order: string; dasar: "modal" | "jual"; arah: "semua" | "lebih" | "kurang" | "sama" };
type SourceResult = { id: string; order_id: string; no_hasil: string; tanggal: string;
  opname_orders: { no_opname: string; warehouse_id: string; warehouses: { name: string; branch_id: string } | null } | null };
export type OpnameEntry = { resultId: string; orderId: string; resultNo: string; orderNo: string; date: string; warehouseId: string; warehouse: string; branchId: string; branch: string };
export type OpnamePriceRow = { itemId: string; code: string; name: string; unit: string; systemQty: number; physicalQty: number; difference: number;
  unitCost: string | null; costSource: string; branchPrice: string; modalDifference: string | null; saleDifference: string; modalDifferenceSource: string; stockAfter: number; stockValueAfter: string | null };
export type OpnameJournalReview = { status: "cocok" | "perlu-periksa" | "tanpa-selisih" | "tidak-tersedia";
  expectedGain: string | null; expectedLoss: string | null; ledgerGain: string; ledgerLoss: string;
  journals: { id: string; number: string; debit: string; credit: string; accounts: string[]; valid: boolean }[] };
export type OpnamePriceReport = { filters: OpnameFilters; entries: OpnameEntry[]; branches: { id: string; name: string }[];
  selected: OpnameEntry | null; scope: "Sebagian" | "Seluruh" | null; method: string | null; revision: number | null;
  rows: OpnamePriceRow[]; shown: OpnamePriceRow[]; plus: string | null; minus: string | null; net: string | null; unavailable: number; legacy: boolean;
  journalReview: OpnameJournalReview | null };

export function opnameFilters(params: OpnameReportParams): OpnameFilters {
  const today = hariIniWIB();
  const filters: OpnameFilters = { dari: params.dari || `${today.slice(0, 8)}01`, sampai: params.sampai || today,
    cabang: params.cabang || "", order: params.order || "", dasar: params.dasar === "jual" ? "jual" : "modal",
    arah: params.arah === "lebih" || params.arah === "kurang" || params.arah === "sama" ? params.arah : "semua" };
  if (!validReportDate(filters.dari) || !validReportDate(filters.sampai) || filters.dari > filters.sampai) throw new ReportInputError("Rentang tanggal laporan tidak valid");
  if (filters.order && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filters.order)) throw new ReportInputError("Identitas opname tidak valid");
  return filters;
}

async function reportActor(client: SupabaseClient) {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new ReportAccessError("Sesi tidak ditemukan", 401);
  const { data: profile, error: profileError } = await client.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (profileError || !profile || profile.is_active !== true || !["OWNER", "FINANCE"].includes(profile.role)) throw new ReportAccessError("Laporan harga opname hanya untuk OWNER dan FINANCE aktif", 403);
  const rules = await readReportRows<{ role: string; module_id: string }>(async (from, to) => {
    const r = await client.from("role_modules").select("role,module_id", { count: "exact" }).eq("role", profile.role).order("module_id").range(from, to);
    return { data: r.data, error: r.error, count: r.count };
  }, row => `${row.role}:${row.module_id}`);
  if (!bolehBukaPath(profile.role, OPNAME_REPORT_PATH, rules)) throw new ReportAccessError("Akses modul laporan ditolak", 403);
}

const price = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new ReportInputError(`Snapshot ${label} tidak lengkap`);
  return value;
};
const optionalPrice = (value: unknown, label: string): string | null => value === null ? null : price(value, label);
const quantity = (value: unknown, label: string): number => {
  const n = Number(value);
  if ((typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)))
    || !Number.isFinite(n) || Math.abs(n) > 1e12) throw new ReportInputError(`Snapshot ${label} tidak valid`);
  return n;
};
const amount = (row: OpnamePriceRow, basis: OpnameFilters["dasar"]): string | null => basis === "modal" ? row.modalDifference : row.saleDifference;
export function opnameSummary(rows: OpnamePriceRow[], basis: OpnameFilters["dasar"]) {
  let plus = new Decimal(0), minus = new Decimal(0), unavailable = 0;
  for (const row of rows) {
    const value = amount(row, basis);
    if (value === null) { unavailable++; continue; }
    const number = new Decimal(value);
    if (number.gte(0)) plus = plus.plus(number); else minus = minus.plus(number);
  }
  return { plus: unavailable ? null : plus.toFixed(), minus: unavailable ? null : minus.toFixed(),
    net: unavailable ? null : plus.plus(minus).toFixed(), unavailable };
}

type SourceJournal = { id: string; no_jurnal: string | null; tanggal: string; branch_id: string | null; voided_at: string | null;
  journal_lines: { debit: number | string; credit: number | string; coa_accounts: { code: string; name: string } | null }[] };

// Read the source journals by exact result number. This is a review of the original
// posting, not a repair of historical effects or a policy decision about the contra account.
export async function loadOpnameJournalReview(client: SupabaseClient, selected: OpnameEntry, rows: OpnamePriceRow[], legacy: boolean): Promise<OpnameJournalReview> {
  const source = await readReportRows<SourceJournal>(async (from, to) => {
    const r = await client.from("journal_entries")
      .select("id,no_jurnal,tanggal,branch_id,voided_at,journal_lines(debit,credit,coa_accounts(code,name))", { count: "exact" })
      .eq("source", "opname").eq("source_ref", selected.resultNo).order("id").range(from, to);
    return { data: r.data as unknown as SourceJournal[] | null, error: r.error, count: r.count };
  });
  if (source.length > 100) throw new ReportInputError("Terlalu banyak jurnal untuk satu hasil opname; periksa nomor sumber");
  let ledgerGain = new Decimal(0), ledgerLoss = new Decimal(0);
  const journals = source.map(entry => {
    let debit = new Decimal(0), credit = new Decimal(0);
    const accounts = new Set<string>();
    if (!Array.isArray(entry.journal_lines)) throw new ReportInputError("Rincian jurnal opname tidak tersedia");
    for (const line of entry.journal_lines) {
      const dr = new Decimal(String(line.debit)), cr = new Decimal(String(line.credit));
      if (!dr.isFinite() || !cr.isFinite() || dr.lt(0) || cr.lt(0) || !line.coa_accounts?.code) throw new ReportInputError("Rincian jurnal opname tidak valid");
      debit = debit.plus(dr); credit = credit.plus(cr);
      accounts.add(`${line.coa_accounts.code} ${line.coa_accounts.name}`);
      if (line.coa_accounts.code === "170001") { ledgerGain = ledgerGain.plus(dr); ledgerLoss = ledgerLoss.plus(cr); }
    }
    return { id: entry.id, number: entry.no_jurnal ?? entry.id, debit: debit.toFixed(), credit: credit.toFixed(), accounts: [...accounts],
      valid: entry.tanggal === selected.date && entry.branch_id === selected.branchId && !entry.voided_at && entry.journal_lines.length > 0 && debit.eq(credit) };
  });
  const expected = legacy ? null : opnameSummary(rows, "modal");
  const expectedGain = expected?.plus ?? null, expectedLoss = expected?.minus === null || expected === null ? null : new Decimal(expected.minus).neg().toFixed();
  const matches = expectedGain !== null && expectedLoss !== null && ledgerGain.eq(expectedGain) && ledgerLoss.eq(expectedLoss)
    && journals.every(row => row.valid) && (journals.length > 0 || new Decimal(expectedGain).eq(0) && new Decimal(expectedLoss).eq(0));
  return { status: legacy || expectedGain === null || expectedLoss === null ? "tidak-tersedia" :
      matches ? journals.length ? "cocok" : "tanpa-selisih" : "perlu-periksa",
    expectedGain, expectedLoss, ledgerGain: ledgerGain.toFixed(), ledgerLoss: ledgerLoss.toFixed(), journals };
}

export async function loadOpnamePriceReport(client: SupabaseClient, params: OpnameReportParams): Promise<OpnamePriceReport> {
  const filters = opnameFilters(params);
  await reportActor(client);
  const allBranches = await readReportRows<{ id: string; name: string }>(async (from, to) => {
    const r = await client.from("branches").select("id,name", { count: "exact" }).order("id").range(from, to);
    return { data: r.data, error: r.error, count: r.count };
  });
  const names: typeof allBranches = [];
  for (const branch of allBranches) {
    // Exclude other branches before loading permissively readable result metadata.
    const { data, error } = await client.rpc("user_can_access_branch", { b: branch.id });
    if (error) throw new ReportAccessError("Akses cabang hasil opname tidak dapat diverifikasi", 403);
    if (data === true) names.push(branch);
  }
  const branchIds = names.filter(row => !filters.cabang || row.id === filters.cabang).map(row => row.id);
  if (filters.cabang && !branchIds.length) throw new ReportAccessError("Akses cabang hasil opname ditolak", 403);
  const warehouses = branchIds.length ? await readReportRows<{ id: string; branch_id: string; name: string }>(async (from, to) => {
    const r = await client.from("warehouses").select("id,branch_id,name", { count: "exact" })
      .in("branch_id", branchIds).order("id").range(from, to);
    return { data: r.data, error: r.error, count: r.count };
  }) : [];
  const warehouseIds = warehouses.map(row => row.id);
  const source = warehouseIds.length ? await readReportRows<SourceResult>(async (from, to) => {
    const r = await client.from("opname_results")
      .select("id,order_id,no_hasil,tanggal,opname_orders!inner(no_opname,warehouse_id,warehouses!inner(name,branch_id))", { count: "exact" })
      .in("opname_orders.warehouse_id", warehouseIds)
      .gte("tanggal", filters.dari).lte("tanggal", filters.sampai).order("id").range(from, to);
    return { data: r.data as unknown as SourceResult[] | null, error: r.error, count: r.count };
  }) : [];
  if (source.length > 5000) throw new ReportInputError("Terlalu banyak hasil opname; persempit periode laporan");
  const warehouseMap = new Map(warehouses.map(row => [row.id, row]));
  if (source.some(row => !row.opname_orders?.warehouses?.branch_id ||
    warehouseMap.get(row.opname_orders.warehouse_id)?.branch_id !== row.opname_orders.warehouses.branch_id))
    throw new ReportInputError("Relasi cabang hasil opname tidak lengkap");
  const branchName = new Map(names.map(row => [row.id, row.name]));
  const entries: OpnameEntry[] = source.map(row => ({ resultId: row.id, orderId: row.order_id, resultNo: row.no_hasil,
    orderNo: row.opname_orders!.no_opname, date: row.tanggal, warehouseId: row.opname_orders!.warehouse_id,
    warehouse: row.opname_orders!.warehouses!.name, branchId: row.opname_orders!.warehouses!.branch_id,
    branch: branchName.get(row.opname_orders!.warehouses!.branch_id) ?? "" }))
    .filter(row => !filters.cabang || row.branchId === filters.cabang)
    .sort((a, b) => b.date.localeCompare(a.date) || a.resultNo.localeCompare(b.resultNo));
  if (entries.some(row => !row.resultId || !row.orderId || !row.resultNo || !row.orderNo || !row.branch || !row.warehouse)) throw new ReportInputError("Identitas hasil opname tidak lengkap");
  const selected = filters.order ? entries.find(row => row.orderId === filters.order) ?? null : null;
  if (filters.order && !selected) throw new ReportInputError("Hasil opname tidak ada dalam periode dan cabang terpilih");
  if (selected && entries.filter(row => row.orderId === selected.orderId).length !== 1) throw new ReportInputError("Hasil opname ganda; rekonsiliasi dokumen asal diperlukan");
  let scope: "Sebagian" | "Seluruh" | null = null, method: string | null = null, revision: number | null = null, rows: OpnamePriceRow[] = [], legacy = false;
  if (selected) {
    const { data, error } = await client.rpc("read_opname_price_report", { p_result_id: selected.resultId });
    if (error) throw new ReportAccessError("Snapshot harga opname tidak dapat diakses", 403);
    if (data === null) legacy = true;
    else {
      if (typeof data !== "object" || data.version !== 1 || !["fifo", "moving_average"].includes(data.method)
        || !["Sebagian", "Seluruh"].includes(data.scope) || !Array.isArray(data.rows)
        || data.branch_id !== selected.branchId || data.warehouse_id !== selected.warehouseId) throw new ReportInputError("Snapshot harga opname tidak sesuai dokumen asal");
      scope = data.scope; method = data.method;
      revision = data.correction_revision === null ? null : quantity(data.correction_revision, "revisi koreksi");
      const seen = new Set<string>();
      rows = data.rows.map((raw: Record<string, unknown>) => {
        if (typeof raw.item_id !== "string" || !raw.item_id || seen.has(raw.item_id) || typeof raw.code !== "string" || typeof raw.name !== "string" || typeof raw.unit !== "string") throw new ReportInputError("Identitas barang opname tidak lengkap atau ganda");
        seen.add(raw.item_id);
        const systemQty = quantity(raw.qty_sistem, "qty sistem"), physicalQty = quantity(raw.qty_fisik, "qty fisik"), difference = quantity(raw.selisih, "selisih");
        if (!new Decimal(String(raw.qty_fisik)).minus(String(raw.qty_sistem)).eq(String(raw.selisih)))
          throw new ReportInputError("Jumlah hasil opname tidak cocok");
        const modalDifference = optionalPrice(raw.nilai_selisih_modal, "nilai modal");
        if (method === "fifo" && modalDifference === null) throw new ReportInputError("Nilai modal FIFO opname tidak lengkap");
        return { itemId: raw.item_id as string, code: raw.code as string, name: raw.name as string, unit: raw.unit as string,
          systemQty, physicalQty, difference, stockAfter: quantity(raw.qty_stok_setelah, "stok setelah posting"),
          stockValueAfter: optionalPrice(raw.nilai_lapisan_setelah, "nilai lapisan"), unitCost: optionalPrice(raw.modal_satuan, "modal satuan"),
          costSource: String(raw.sumber_modal ?? ""), branchPrice: price(raw.harga_jual_cabang, "harga jual cabang"),
          modalDifference, saleDifference: price(raw.nilai_selisih_jual, "nilai jual"), modalDifferenceSource: String(raw.sumber_nilai_modal ?? "") };
      });
    }
  }
  const shown = rows.filter(row => filters.arah === "semua" || (filters.arah === "lebih" && row.difference > 0)
    || (filters.arah === "kurang" && row.difference < 0) || (filters.arah === "sama" && row.difference === 0));
  const summary = opnameSummary(shown, filters.dasar);
  const journalReview = selected ? await loadOpnameJournalReview(client, selected, rows, legacy) : null;
  return { filters, entries, branches: names, selected, scope, method, revision, rows, shown, legacy, journalReview, ...summary };
}
