/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  classifyCustomers,
  outstandingPoQty,
  rankMovement,
  resolveSalesTarget,
  salesMetrics,
  stockCoverage,
  stockValue,
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
  stockValue: number;
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
type SaleRow = { id: string; branch_id: string; customer_id: string | null; total: number; channel: string | null; created_at: string; sale_items: SaleItem[] | null };
type InvoiceItem = { item_id: string | null; qty: number; hpp: number | null; harga: number; jenis: string | null };
type VisitRow = { id: string; branch_id: string; customer_id: string | null };
type InvoiceRow = { id: string; visit_id: string; total: number; created_at: string; voided_at: string | null; invoice_items: InvoiceItem[] | null };
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
  let returns: { sale_id: string; total: number }[] = [];

  if (filter.channel !== "klinik" && filter.channel !== "reseller") {
    let query = supabase.from("sales")
      .select("id,branch_id,customer_id,total,channel,created_at,sale_items(item_id,qty,hpp,harga,items(item_type,tindakan_kategori))")
      .in("branch_id", scope.branchIds).gte("created_at", start).lte("created_at", end);
    query = applyChannel(query, filter.channel);
    const salesResult = await read(query);
    queryError(salesResult);
    const sales = (salesResult.data ?? []) as SaleRow[];
    if (sales.length > 0) {
      const returnResult = await read(supabase.from("sales_returns").select("sale_id,total").in("sale_id", sales.map((sale) => sale.id)).lte("tanggal", filter.to));
      queryError(returnResult);
      returns = (returnResult.data ?? []) as { sale_id: string; total: number }[];
    }
    const returnMap = new Map<string, number>();
    for (const row of returns) returnMap.set(row.sale_id, (returnMap.get(row.sale_id) ?? 0) + (Number(row.total) || 0));
    for (const sale of sales) {
      const items = sale.sale_items ?? [];
      documents.push(itemNetRows(
        sale.id,
        sale.branch_id,
        sale.customer_id,
        sale.created_at,
        Number(sale.total) || 0,
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
        returnMap.get(sale.id) ?? 0,
      ));
    }
  }

  let visits: VisitRow[] = [];
  if (filter.channel !== "pos" && filter.channel !== "online" && filter.channel !== "reseller") {
    const visitsResult = await read(supabase.from("visits")
      .select("id,branch_id,customer_id")
      .in("branch_id", scope.branchIds).gte("created_at", start).lte("created_at", end));
    queryError(visitsResult);
    visits = (visitsResult.data ?? []) as VisitRow[];
    const invoiceQuery = supabase.from("invoices")
      .select("id,visit_id,total,created_at,voided_at,invoice_items(item_id,qty,hpp,harga,jenis)")
      .in("visit_id", visits.map((visit) => visit.id)).is("voided_at", null)
      .gte("created_at", start).lte("created_at", end);
    const invoiceResult = await read(invoiceQuery);
    queryError(invoiceResult);
    const visitMap = new Map(visits.map((visit) => [visit.id, visit]));
    for (const invoice of (invoiceResult.data ?? []) as InvoiceRow[]) {
      const visit = visitMap.get(invoice.visit_id);
      if (!visit) continue;
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
    const resellerResult = await read(supabase.from("sales_invoices")
      .select("id,branch_id,customer_id,dpp,tanggal,status,sales_invoice_items(item_id,qty,harga)")
      .in("branch_id", scope.branchIds).neq("status", "batal")
      .gte("tanggal", filter.from).lte("tanggal", filter.to));
    queryError(resellerResult);
    for (const invoice of (resellerResult.data ?? []) as ResellerRow[]) {
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
  return { documents, visits };
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
  const { start, end } = dateBounds(filter);
  const currentResult = await read(supabase.from("sales")
    .select("id,customer_id,total,created_at,channel")
    .in("branch_id", scope.branchIds).gte("created_at", start).lte("created_at", end));
  queryError(currentResult);
  const historyResult = await read(supabase.from("sales")
    .select("id,customer_id,total,created_at,channel")
    .in("branch_id", scope.branchIds).lte("created_at", end));
  queryError(historyResult);
  const rows = [...(historyResult.data ?? []) as any[]].map((row) => ({
    customerId: row.customer_id ?? null,
    saleId: row.id,
    date: String(row.created_at).slice(0, 10),
    net: Number(row.total) || 0,
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
  const [stockResult, layerResult, moveResult, itemResult] = await Promise.all([
    read(supabase.from("stock").select("warehouse_id,item_id,qty").in("warehouse_id", warehouseIds).lte("updated_at", end)),
    read(supabase.from("stock_layers").select("warehouse_id,item_id,qty_left,unit_cost").in("warehouse_id", warehouseIds).gt("qty_left", 0).lte("tanggal", filter.to)),
    read(supabase.from("stock_moves").select("warehouse_id,item_id,qty,tanggal").in("warehouse_id", warehouseIds).gte("tanggal", start.slice(0, 10)).lte("tanggal", filter.to)),
    read(supabase.from("items").select("id,min_stock").eq("is_active", true)),
  ]);
  for (const result of [stockResult, layerResult, moveResult, itemResult]) queryError(result);
  const stockRows = stockResult.data ?? [];
  const layers = layerResult.data ?? [];
  const moves = moveResult.data ?? [];
  const usage = new Map<string, number>();
  for (const row of moves) if (Number(row.qty) < 0) usage.set(row.item_id, (usage.get(row.item_id) ?? 0) + Math.abs(Number(row.qty)));
  const movementRows: MovementRow[] = stockRows.map((row: any) => {
    const itemMoves = moves.filter((move: any) => move.item_id === row.item_id && Number(move.qty) < 0);
    return { itemId: row.item_id, soldQty: usage.get(row.item_id) ?? 0, stockQty: Number(row.qty) || 0, lastSoldAt: itemMoves.length ? itemMoves.map((move: any) => move.tanggal).sort().at(-1) ?? null : null };
  });
  const totalAvailable = stockRows.reduce((total: number, row: any) => total + Math.max(0, Number(row.qty) || 0), 0);
  const totalUsage = [...usage.values()].reduce((total, value) => total + value, 0);
  const minimumByItem = new Map<string, number>((itemResult.data ?? []).map((row: any) => [String(row.id), Number(row.min_stock) || 0]));
  return {
    stockValue: stockValue(layers),
    coverageDays: stockCoverage(totalAvailable, totalUsage),
    lowStock: stockRows.filter((row: any) => (Number(row.qty) || 0) < (minimumByItem.get(String(row.item_id)) ?? 0)).length,
    fastMoving: rankMovement(movementRows, filter.to, 90).fast,
    slowMoving: rankMovement(movementRows, filter.to, 90).slow,
  };
}

export async function collectPurchaseBlock(scope: DashboardScope, filter: DashboardFilter, supabase: AnyClient): Promise<PurchaseBlock> {
  const poResult = await read(supabase.from("purchase_orders")
    .select("id,branch_id,tanggal,total,status,purchase_order_items(item_id,qty,harga_beli)")
    .in("branch_id", scope.branchIds).gte("tanggal", filter.from).lte("tanggal", filter.to));
  queryError(poResult);
  const orders = poResult.data ?? [];
  const poIds = orders.map((row: any) => row.id);
  const invoiceResult = await read(supabase.from("purchase_invoices")
    .select("id,po_id,total,tanggal,supplier_id,suppliers(nama),purchase_invoice_items(item_id,qty,harga)")
    .in("po_id", poIds).gte("tanggal", filter.from).lte("tanggal", filter.to));
  queryError(invoiceResult);
  const returnsResult = await read(supabase.from("purchase_returns")
    .select("total,tanggal,po_id").in("po_id", poIds).gte("tanggal", filter.from).lte("tanggal", filter.to));
  queryError(returnsResult);
  const receivedByKey = new Map<string, number>();
  for (const invoice of (invoiceResult.data ?? []) as any[]) {
    for (const item of invoice.purchase_invoice_items ?? []) {
      const key = `${invoice.po_id}:${item.item_id ?? item.nama}`;
      receivedByKey.set(key, (receivedByKey.get(key) ?? 0) + (Number(item.qty) || 0));
    }
  }
  const outstandingRows = orders.flatMap((order: any) => (order.purchase_order_items ?? []).map((item: any) => ({
    orderedQty: Number(item.qty) || 0,
    receivedQty: receivedByKey.get(`${order.id}:${item.item_id ?? item.nama}`) ?? 0,
  })));
  const supplierRows = (invoiceResult.data ?? []).flatMap((invoice: any) => {
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
    purchase: (invoiceResult.data ?? []).reduce((total: number, row: any) => total + (Number(row.total) || 0), 0),
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
  const [sales, branch, customer, stock, purchase, clinic] = await Promise.all([
    safeBlock(() => collectSalesBlock(scope, filter, supabase)),
    safeBlock(() => collectBranchBlock(scope, filter, supabase)),
    safeBlock(() => collectCustomerBlock(scope, filter, supabase)),
    safeBlock(() => collectStockBlock(scope, filter, supabase)),
    safeBlock(() => collectPurchaseBlock(scope, filter, supabase)),
    safeBlock(() => collectClinicBlock(scope, filter, supabase)),
  ]);
  return { scope, filter, sales, branch, customer, stock, purchase, clinic };
}
