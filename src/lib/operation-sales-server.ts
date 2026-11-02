/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  classifyCustomers,
  outstandingPoQty,
  rankMovement,
  resolveSalesTarget,
  salesMetrics,
  stockCoverage,
  supplierPerformance,
  type BranchPerformance,
  type Channel,
  type CustomerClassification,
  type DashboardFilter,
  type MovementRow,
  type SalesMetricRow,
  type SupplierPerformance,
} from "./operation-sales";
import { collectOperationalClinic } from "./operasional-klinik-server";
import { batasTanggalWIB } from "./laporan-transaksi";
import { completeReportQuery } from "./report-query";
import { isCompletedSale, saleMerchandiseTotal, saleRefundMerchantFee, type SaleCompletion, type SaleMerchantTotal } from "./sale-payment-reporting";

type AnyClient = any;

type BlockReady<T> = { status: "ready"; data: T };
type BlockMissing = { status: "missing"; reason: string };
type BlockError = { status: "error"; correlationId: string };
export type DashboardBlock<T> = BlockReady<T> | BlockMissing | BlockError;

export type DashboardBranch = { id: string; name: string };

export type DashboardScope = {
  branchIds: string[];
  branches: DashboardBranch[];
};

export type SalesBlock = {
  metrics: ReturnType<typeof salesMetrics>;
  target: number | null;
  branches: BranchPerformance[];
  split: { product: number; service: number; clinic: number };
};

export type CustomerBlock = {
  classification: CustomerClassification;
  totalCustomers: number;
  topSpenders: { customerId: string; spending: number }[];
};

export type StockBlock = {
  coverageDays: number | null;
  lowStock: number;
  fastMoving: MovementRow[];
  slowMoving: MovementRow[];
};

export type PurchaseBlock = {
  purchase: number;
  outstandingPoQty: number;
  supplierPerformance: SupplierPerformance[];
  promisedDeliveryAvailable: false;
};

export type ClinicBlock = Awaited<ReturnType<typeof collectOperationalClinic>>;

export type DashboardData = {
  scope: DashboardScope;
  filter: DashboardFilter;
  sales: DashboardBlock<SalesBlock>;
  branch: DashboardBlock<BranchPerformance[]>;
  customer: DashboardBlock<CustomerBlock>;
  stock: DashboardBlock<StockBlock>;
  purchase: DashboardBlock<PurchaseBlock>;
  clinic: DashboardBlock<ClinicBlock>;
};

type QueryResult = { data: any; error: { message: string; code?: string } | null };

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function dateBounds(filter: DashboardFilter) {
  const { mulai, akhir } = batasTanggalWIB(filter.from, filter.to);
  return { start: mulai, end: akhir };
}

function ensureDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Rentang tanggal tidak valid");
}

function queryError(result: QueryResult): void {
  if (!result.error) return;
  const error = new Error(result.error.message);
  (error as Error & { code?: string }).code = result.error.code;
  throw error;
}

async function read(query: AnyClient): Promise<QueryResult> {
  return await query;
}

// Report rows are read page by page with an exact count (completeReportQuery). A plain
// select stops silently at PostgREST's max-rows (1000 on Supabase), so a busy month
// across all branches would under-count. An incomplete read throws, and safeBlock turns
// it into an error block instead of a smaller number. Every query passed here must
// select `id` and ask for `{ count: "exact" }`.
async function readAll<T>(query: AnyClient): Promise<T[]> {
  return (await completeReportQuery<T>(query)).data;
}

/** Ids per `.in()` filter: a long id list in the URL is rejected by the proxy (same limit as faktur-gabungan). */
const ID_BATCH = 100;
const BATCH_CONCURRENCY = 6;

async function readAllByIds<T>(ids: string[], query: (batch: string[]) => AnyClient): Promise<T[]> {
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  for (let start = 0; start < unique.length; start += ID_BATCH) batches.push(unique.slice(start, start + ID_BATCH));
  const rows: T[] = [];
  for (let index = 0; index < batches.length; index += BATCH_CONCURRENCY) {
    const pages = await Promise.all(batches.slice(index, index + BATCH_CONCURRENCY).map((batch) => readAll<T>(query(batch))));
    for (const page of pages) rows.push(...page);
  }
  return rows;
}

function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: string } | null)?.message ?? "").toLowerCase();
  return code === "42P01" || code === "42703" || code === "PGRST204" || message.includes("does not exist");
}

function correlationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function safeBlock<T>(load: () => Promise<T>): Promise<DashboardBlock<T>> {
  try {
    return { status: "ready", data: await load() };
  } catch (error) {
    if (isMissingSchema(error)) return { status: "missing", reason: "Data sumber belum tersedia" };
    return { status: "error", correlationId: correlationId() };
  }
}

function roleAllowsAllBranches(role: string): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "FINANCE";
}

export async function resolveDashboardScope(supabase: AnyClient, requestedBranchIds: string[] = []): Promise<DashboardScope> {
  const userResult = await supabase.auth.getUser();
  if (userResult.error || !userResult.data?.user?.id) throw new Error("Sesi pengguna tidak tersedia");
  const userId = userResult.data.user.id;
  const [{ data: profileRows, error: profileError }, { data: assignments, error: assignmentError }] = await Promise.all([
    read(supabase.from("profiles").select("role").eq("id", userId).limit(1)),
    read(supabase.from("user_branches").select("branch_id").eq("user_id", userId)),
  ]);
  queryError({ data: profileRows, error: profileError });
  queryError({ data: assignments, error: assignmentError });

  const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows;
  const role = String(profile?.role ?? "STAFF");
  const assignedIds = unique((assignments ?? []).map((row: any) => String(row.branch_id)));
  const requested = unique(requestedBranchIds);
  if (!roleAllowsAllBranches(role) && requested.some((branchId) => !assignedIds.includes(branchId))) {
    throw new Error("Akses cabang ditolak");
  }

  let branchQuery = supabase.from("branches").select("id, name").eq("is_active", true);
  if (requested.length > 0) branchQuery = branchQuery.in("id", requested);
  const branchResult = await read(branchQuery);
  queryError(branchResult);
  const branchRows = (branchResult.data ?? []) as DashboardBranch[];
  if (requested.length > 0 && branchRows.length !== requested.length) throw new Error("Akses cabang ditolak");
  const candidates = requested.length > 0 ? requested : branchRows.map((row) => row.id);

  const access = await Promise.all(candidates.map(async (branchId) => {
    const result = await supabase.rpc("user_can_access_branch", { b: branchId });
    if (result.error) throw new Error(result.error.message);
    return { branchId, allowed: result.data === true };
  }));
  const allowedIds = access.filter((row) => row.allowed).map((row) => row.branchId);
  if (requested.length > 0 && allowedIds.length !== requested.length) throw new Error("Akses cabang ditolak");
  const scopedIds = roleAllowsAllBranches(role) ? allowedIds : allowedIds.filter((id) => assignedIds.includes(id));
  const scopedBranches = branchRows.filter((row) => scopedIds.includes(row.id));
  return { branchIds: scopedIds, branches: scopedBranches };
}

function applyChannel(query: AnyClient, channel: Channel): AnyClient {
  if (channel === "pos") return query.is("channel", null);
  if (channel === "online") return query.not("channel", "is", null);
  return query;
}

type SaleItem = { item_id: string | null; qty: number; hpp: number | null; harga: number; items?: { item_type: string | null; tindakan_kategori: string | null } | { item_type: string | null; tindakan_kategori: string | null }[] | null };
type SaleRow = SaleCompletion & SaleMerchantTotal & { id: string; branch_id: string; customer_id: string | null; total: number; channel: string | null; created_at: string; sale_items: SaleItem[] | null };
type InvoiceItem = { item_id: string | null; qty: number; hpp: number | null; harga: number; jenis: string | null };
type InvoiceVisit = { branch_id: string; customer_id: string | null };
type InvoiceRow = { id: string; visit_id: string; total: number; created_at: string; voided_at: string | null; visits: InvoiceVisit | InvoiceVisit[] | null; invoice_items: InvoiceItem[] | null };
type ResellerItem = { item_id: string | null; qty: number; harga: number };
type ResellerRow = { id: string; branch_id: string | null; customer_id: string | null; dpp: number; tanggal: string; status: string; sales_invoice_items: ResellerItem[] | null };

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function itemNetRows(
  documentId: string,
  branchId: string,
  customerId: string | null,
  date: string,
  total: number,
  items: { qty: number; hpp?: number | null; harga: number; itemId?: string | null; kind: "product" | "service" | "clinic" }[],
  returnTotal = 0,
): { branchId: string; customerId: string | null; date: string; source: "sale"; rows: SalesMetricRow[]; kindValues: { product: number; service: number; clinic: number } } {
  const net = total - returnTotal;
  const gross = items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.harga) || 0), 0);
  const rows = items.length > 0 ? items.map((item, index) => {
    const share = index === 0 ? net - items.slice(1).reduce((sum, other) => sum + (gross > 0 ? net * ((Number(other.qty) || 0) * (Number(other.harga) || 0)) / gross : 0), 0) : gross > 0 ? net * ((Number(item.qty) || 0) * (Number(item.harga) || 0)) / gross : 0;
    return {
      saleId: documentId,
      qty: Number(item.qty) || 0,
      net: share,
      cost: Number(item.hpp) || 0,
      status: "paid",
    };
  }) : [{ saleId: documentId, qty: 0, net, cost: 0, status: "paid" }];
  const kindValues = { product: 0, service: 0, clinic: 0 };
  items.forEach((item, index) => { kindValues[item.kind] += rows[index]?.net ?? 0; });
  return { branchId, customerId, date, source: "sale", rows, kindValues };
}

async function loadSalesDocuments(supabase: AnyClient, scope: DashboardScope, filter: DashboardFilter) {
  const { start, end } = dateBounds(filter);
  const documents: ReturnType<typeof itemNetRows>[] = [];

  if (filter.channel !== "klinik" && filter.channel !== "reseller") {
    let query = supabase.from("sales")
      .select("id,branch_id,customer_id,total,merchant_fee_total,channel,created_at,payment_plan,payments_finalized_at, voided_at,sale_items(item_id,qty,hpp,harga,items(item_type,tindakan_kategori))", { count: "exact" })
      .in("branch_id", scope.branchIds).gte("created_at", start).lte("created_at", end);
    query = applyChannel(query, filter.channel);
    const sales = (await readAll<SaleRow>(query)).filter(isCompletedSale);
    const returns = await readAllByIds<{ id: string; sale_id: string; total: number }>(sales.map((sale) => sale.id), (batch) =>
      supabase.from("sales_returns").select("id,sale_id,total", { count: "exact" }).is("voided_at", null).in("sale_id", batch).lte("tanggal", filter.to));
    const returnMap = new Map<string, number>();
    for (const row of returns) returnMap.set(row.sale_id, (returnMap.get(row.sale_id) ?? 0) + (Number(row.total) || 0));
    for (const sale of sales) {
      const items = sale.sale_items ?? [];
      documents.push(itemNetRows(
        sale.id,
        sale.branch_id,
        sale.customer_id,
        sale.created_at,
        saleMerchandiseTotal(sale),
        items.map((item) => {
          const master = one(item.items);
          return {
            qty: item.qty,
            hpp: item.hpp,
            harga: item.harga,
            itemId: item.item_id,
            kind: master?.item_type === "Jasa" ? "service" : "product",
          };
        }),
        (returnMap.get(sale.id) ?? 0) - saleRefundMerchantFee(sale, returnMap.get(sale.id) ?? 0),
      ));
    }
  }

  if (filter.channel !== "pos" && filter.channel !== "online" && filter.channel !== "reseller") {
    // Omzet klinik milik tanggal tagihannya, bukan tanggal kunjungannya: antrean membawa
    // kunjungan yang belum dibayar ke hari berikutnya, jadi kunjungan tgl D sering
    // ditagih tgl D+1. Cabang tetap diambil dari kunjungan (invoices tidak punya
    // branch_id); `!inner` membuang tagihan yang kunjungannya di luar cabang scope.
    // Jumlah kunjungan (blok klinik) tetap dihitung dari tanggal daftar kunjungan.
    const invoices = await readAll<InvoiceRow>(supabase.from("invoices")
      .select("id,visit_id,total,created_at,voided_at,visits!inner(branch_id,customer_id),invoice_items(item_id,qty,hpp,harga,jenis)", { count: "exact" })
      .in("visits.branch_id", scope.branchIds).is("voided_at", null)
      .gte("created_at", start).lte("created_at", end));
    const seen = new Set<string>();
    for (const invoice of invoices) {
      const visit = one(invoice.visits);
      if (!visit || !scope.branchIds.includes(visit.branch_id) || seen.has(invoice.id)) continue;
      seen.add(invoice.id);
      documents.push(itemNetRows(
        invoice.id,
        visit.branch_id,
        visit.customer_id,
        invoice.created_at,
        Number(invoice.total) || 0,
        (invoice.invoice_items ?? []).map((item) => ({ qty: item.qty, hpp: item.hpp, harga: item.harga, itemId: item.item_id, kind: "clinic" as const })),
      ));
    }
  }

  if (filter.channel === "all" || filter.channel === "reseller") {
    const resellerInvoices = await readAll<ResellerRow>(supabase.from("sales_invoices")
      .select("id,branch_id,customer_id,dpp,tanggal,status,sales_invoice_items(item_id,qty,harga)", { count: "exact" })
      .in("branch_id", scope.branchIds).neq("status", "batal").is("opening_batch_id", null)
      .gte("tanggal", filter.from).lte("tanggal", filter.to));
    for (const invoice of resellerInvoices) {
      documents.push(itemNetRows(
        invoice.id,
        invoice.branch_id ?? "",
        invoice.customer_id,
        invoice.tanggal,
        Number(invoice.dpp) || 0,
        (invoice.sales_invoice_items ?? []).map((item) => ({ qty: item.qty, harga: item.harga, itemId: item.item_id, kind: "product" as const })),
      ));
    }
  }
  return { documents };
}

function salesBlockFromDocuments(scope: DashboardScope, documents: ReturnType<typeof itemNetRows>[], targetRows: any[]): SalesBlock {
  const metricRows = documents.flatMap((document) => document.rows);
  const branches = scope.branches.map((branch) => {
    const rows = documents.filter((document) => document.branchId === branch.id).flatMap((document) => document.rows);
    const metrics = salesMetrics(rows);
    const customerIds = new Set(documents.filter((document) => document.branchId === branch.id && document.customerId).map((document) => document.customerId!));
    return {
      branchId: branch.id,
      branchName: branch.name,
      sales: metrics.sales,
      achievement: null,
      growth: null,
      transactions: metrics.transactions,
      atv: metrics.atv,
      grossMargin: metrics.grossMargin,
      uniqueCustomers: customerIds.size,
      target: resolveSalesTarget(targetRows, [branch.id], "") ?? null,
    } as BranchPerformance & { target: number | null };
  });
  const split = { product: 0, service: 0, clinic: 0 };
  for (const document of documents) for (const kind of ["product", "service", "clinic"] as const) split[kind] += document.kindValues[kind];
  return {
    metrics: salesMetrics(metricRows),
    target: null,
    branches,
    split,
  };
}

export async function collectSalesBlock(scope: DashboardScope, filter: DashboardFilter, supabase: AnyClient): Promise<SalesBlock> {
  ensureDate(filter.from);
  ensureDate(filter.to);
  if (filter.from > filter.to) throw new Error("Rentang tanggal tidak valid");
  const [{ documents }, { data: targets, error: targetError }] = await Promise.all([
    loadSalesDocuments(supabase, scope, filter),
    read(supabase.from("sales_targets").select("periode,target,branch_id,employee_id,category_id").eq("periode", filter.from.slice(0, 7))),
  ]);
  queryError({ data: targets, error: targetError });
  const targetRows = (targets ?? []).map((row: any) => ({
    period: String(row.periode), amount: Number(row.target) || 0,
    branchId: row.branch_id ?? null, employeeId: row.employee_id ?? null, categoryId: row.category_id ?? null,
  }));
  const block = salesBlockFromDocuments(scope, documents, targetRows);
  block.target = resolveSalesTarget(targetRows, scope.branchIds, filter.from.slice(0, 7));
  block.branches = block.branches.map((branch) => ({
    ...branch,
    achievement: resolveSalesTarget(targetRows, [branch.branchId], filter.from.slice(0, 7)) === null
      ? null
      : (branch.sales / (resolveSalesTarget(targetRows, [branch.branchId], filter.from.slice(0, 7)) as number)) * 100,
  }));
  return block;
}

export async function collectBranchBlock(scope: DashboardScope, filter: DashboardFilter, supabase: AnyClient): Promise<BranchPerformance[]> {
  return (await collectSalesBlock(scope, filter, supabase)).branches;
}

export async function collectCustomerBlock(scope: DashboardScope, filter: DashboardFilter, supabase: AnyClient): Promise<CustomerBlock> {
  const { end } = dateBounds(filter);
  // All sales up to the end of the period: new/repeat/dormant need each customer's
  // earlier purchases. This set already contains the period itself, so no separate
  // period read is needed. It grows over the years, hence the complete paged read.
  const history = await readAll<any>(supabase.from("sales")
    .select("id,customer_id,total,merchant_fee_total,created_at,channel,payment_plan,payments_finalized_at, voided_at", { count: "exact" })
    .in("branch_id", scope.branchIds).lte("created_at", end));
  const rows = history.filter(isCompletedSale).map((row) => ({
    customerId: row.customer_id ?? null,
    saleId: row.id,
    date: String(row.created_at).slice(0, 10),
    net: saleMerchandiseTotal(row),
    status: "paid",
  }));
  const classification = classifyCustomers(rows, filter, 90, filter.to);
  const topSpenders = Object.entries(classification.spending)
    .map(([customerId, spending]) => ({ customerId, spending }))
    .sort((a, b) => b.spending - a.spending)
    .slice(0, 10);
  return { classification, totalCustomers: new Set(rows.map((row) => row.customerId).filter(Boolean)).size, topSpenders };
}

export async function collectStockBlock(scope: DashboardScope, filter: DashboardFilter, supabase: AnyClient): Promise<StockBlock> {
  const { start, end } = dateBounds(filter);
  const warehouseResult = await read(supabase.from("warehouses").select("id,branch_id").in("branch_id", scope.branchIds).eq("is_active", true));
  queryError(warehouseResult);
  const warehouses = warehouseResult.data ?? [];
  const warehouseIds = warehouses.map((row: any) => row.id);
  const [stockRows, moves, itemRows] = await Promise.all([
    readAll<any>(supabase.from("stock").select("id,warehouse_id,item_id,qty", { count: "exact" }).in("warehouse_id", warehouseIds).lte("updated_at", end)),
    readAll<any>(supabase.from("return_record_effective_stock_moves").select("id,warehouse_id,item_id,qty,tanggal", { count: "exact" }).in("warehouse_id", warehouseIds).gte("tanggal", start.slice(0, 10)).lte("tanggal", filter.to)),
    readAll<any>(supabase.from("items").select("id,min_stock", { count: "exact" }).eq("is_active", true)),
  ]);
  const usage = new Map<string, number>();
  for (const row of moves) if (Number(row.qty) < 0) usage.set(row.item_id, (usage.get(row.item_id) ?? 0) + Math.abs(Number(row.qty)));
  const movementRows: MovementRow[] = stockRows.map((row: any) => {
    const itemMoves = moves.filter((move: any) => move.item_id === row.item_id && Number(move.qty) < 0);
    return { itemId: row.item_id, soldQty: usage.get(row.item_id) ?? 0, stockQty: Number(row.qty) || 0, lastSoldAt: itemMoves.length ? itemMoves.map((move: any) => move.tanggal).sort().at(-1) ?? null : null };
  });
  const totalAvailable = stockRows.reduce((total: number, row: any) => total + Math.max(0, Number(row.qty) || 0), 0);
  const totalUsage = [...usage.values()].reduce((total, value) => total + value, 0);
  const minimumByItem = new Map<string, number>(itemRows.map((row: any) => [String(row.id), Number(row.min_stock) || 0]));
  return {
    coverageDays: stockCoverage(totalAvailable, totalUsage),
    lowStock: stockRows.filter((row: any) => (Number(row.qty) || 0) < (minimumByItem.get(String(row.item_id)) ?? 0)).length,
    fastMoving: rankMovement(movementRows, filter.to, 90).fast,
    slowMoving: rankMovement(movementRows, filter.to, 90).slow,
  };
}

export async function collectPurchaseBlock(scope: DashboardScope, filter: DashboardFilter, supabase: AnyClient): Promise<PurchaseBlock> {
  const orders = await readAll<any>(supabase.from("purchase_orders")
    .select("id,branch_id,tanggal,total,status,purchase_order_items(item_id,qty,harga_beli)", { count: "exact" })
    .in("branch_id", scope.branchIds).gte("tanggal", filter.from).lte("tanggal", filter.to));
  const poIds = orders.map((row: any) => String(row.id));
  // Purchase returns are not read: no figure in this block uses them yet
  // (supplier `returned` is still 0). Add them back with readAllByIds when it does.
  const invoices = await readAllByIds<any>(poIds, (batch) => supabase.from("purchase_invoices")
    .select("id,po_id,total,tanggal,supplier_id,suppliers(nama),purchase_invoice_items(item_id,qty,harga)", { count: "exact" }).is("voided_at", null)
    .in("po_id", batch).gte("tanggal", filter.from).lte("tanggal", filter.to));
  const receivedByKey = new Map<string, number>();
  for (const invoice of invoices) {
    for (const item of invoice.purchase_invoice_items ?? []) {
      const key = `${invoice.po_id}:${item.item_id ?? item.nama}`;
      receivedByKey.set(key, (receivedByKey.get(key) ?? 0) + (Number(item.qty) || 0));
    }
  }
  const outstandingRows = orders.flatMap((order: any) => (order.purchase_order_items ?? []).map((item: any) => ({
    orderedQty: Number(item.qty) || 0,
    receivedQty: receivedByKey.get(`${order.id}:${item.item_id ?? item.nama}`) ?? 0,
  })));
  const supplierRows = invoices.flatMap((invoice: any) => {
    const supplier = one(invoice.suppliers);
    return [{
      supplierId: invoice.supplier_id ?? "unknown",
      supplierName: supplier?.nama ?? "(tanpa pemasok)",
      purchased: Number(invoice.total) || 0,
      orderedQty: 0,
      receivedQty: 0,
      returned: 0,
      poDate: null,
      receivedDate: null,
    }];
  });
  return {
    purchase: invoices.reduce((total: number, row: any) => total + (Number(row.total) || 0), 0),
    outstandingPoQty: outstandingPoQty(outstandingRows),
    supplierPerformance: supplierPerformance(supplierRows),
    promisedDeliveryAvailable: false,
  };
}

export async function collectClinicBlock(scope: DashboardScope, filter: DashboardFilter, supabase: AnyClient): Promise<ClinicBlock> {
  return collectOperationalClinic(supabase, { from: filter.from, to: filter.to, branchIds: scope.branchIds });
}

export async function collectDashboard(supabase: AnyClient, filter: DashboardFilter): Promise<DashboardData> {
  ensureDate(filter.from);
  ensureDate(filter.to);
  const scope = await resolveDashboardScope(supabase, filter.branchIds);
  // The branch block is the sales block's per-branch view: read the (paged) sales
  // sources once and let both blocks share the result.
  const salesBlock = collectSalesBlock(scope, filter, supabase);
  const [sales, branch, customer, stock, purchase, clinic] = await Promise.all([
    safeBlock(() => salesBlock),
    safeBlock(async () => (await salesBlock).branches),
    safeBlock(() => collectCustomerBlock(scope, filter, supabase)),
    safeBlock(() => collectStockBlock(scope, filter, supabase)),
    safeBlock(() => collectPurchaseBlock(scope, filter, supabase)),
    safeBlock(() => collectClinicBlock(scope, filter, supabase)),
  ]);
  return { scope, filter, sales, branch, customer, stock, purchase, clinic };
}
