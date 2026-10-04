import type { SupabaseClient } from "@supabase/supabase-js";
import { bolehBukaPath } from "./akses";
import { batasTanggalWIB } from "./laporan-transaksi";
import { hariIniWIB } from "./tanggal";
import { compoundSales, compoundSummary, validReportDate, valueInventory, type Numeric } from "./hpp-reports";

export type ReportKind = "inventory" | "compound";
export const REPORT_PATHS = { inventory: "/laporan/nilai-persediaan", compound: "/laporan/margin-racikan" } as const;
export type ReportParams = { cabang?: string; gudang?: string; dokter?: string; dari?: string; sampai?: string; q?: string; masalah?: string; halaman?: string };
export type ReportFilters = Required<Omit<ReportParams,"halaman">>;
export class ReportAccessError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export class ReportInputError extends Error {}

type QueryError = { message: string } | null;
const PAGE_SIZE = 500;
const ROW_LIMIT = 5000;
export async function readReportRows<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: QueryError }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from <= ROW_LIMIT; from += PAGE_SIZE) {
    const { data, error } = await read(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Data laporan gagal dibaca: ${error.message}`);
    if (!Array.isArray(data)) throw new Error("Data laporan gagal dibaca: hasil pembacaan tidak tersedia");
    if (from === ROW_LIMIT && data?.length) throw new ReportInputError("Data memuat terlalu banyak baris. Persempit cabang, gudang, atau periode agar laporan tetap lengkap.");
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  return rows;
}

type Query = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;
async function tableRows<T>(client: SupabaseClient, table: string, columns: string, filter: (query: Query) => Query = query => query, order = "id"): Promise<T[]> {
  return readReportRows<T>(async (from, to) => {
    const result = await filter(client.from(table).select(columns)).order(order).range(from, to);
    return { data: result.data as T[] | null, error: result.error };
  });
}
async function byIds<T>(client: SupabaseClient, table: string, columns: string, key: string, ids: string[], order = "id"): Promise<T[]> {
  const rows: T[] = [];
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += 100) {
    rows.push(...await tableRows<T>(client, table, columns, query => query.in(key, unique.slice(start,start+100)), order));
  }
  return rows;
}
type Branch = { id: string; name: string };
export type ReportScope = { role: string; branches: Branch[]; branchIds: string[] };
export async function reportScope(client: SupabaseClient, path: string, branch: string): Promise<ReportScope> {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new ReportAccessError("Sesi tidak ditemukan", 401);
  const { data: profile, error: profileError } = await client.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (profileError || !profile || profile.is_active !== true || !["OWNER","FINANCE"].includes(profile.role)) throw new ReportAccessError("Laporan HPP hanya tersedia untuk akun OWNER dan FINANCE yang aktif", 403);
  const rules = await tableRows<{ role: string; module_id: string }>(client, "role_modules", "role,module_id", query => query.order("module_id"), "role");
  if (!bolehBukaPath(profile.role, path, rules)) throw new ReportAccessError("Akses modul laporan tidak diizinkan", 403);
  const branches = await tableRows<Branch>(client, "branches", "id,name");
  if (branch && !branches.some(row => row.id === branch)) throw new ReportAccessError("Akses cabang ditolak", 403);
  const branchIds = (branch ? branches.filter(row => row.id === branch) : branches).map(row => row.id);
  for (const id of branchIds) {
    const { data: allowed, error: branchError } = await client.rpc("user_can_access_branch", { b: id });
    if (branchError || allowed !== true) throw new ReportAccessError("Akses cabang ditolak", 403);
  }
  return { role: profile.role, branches, branchIds };
}

export function normalizeReportFilters(params: ReportParams): ReportFilters {
  const today = hariIniWIB();
  return { cabang: params.cabang ?? "", gudang: params.gudang ?? "", dokter: params.dokter ?? "",
    dari: params.dari || `${today.slice(0,8)}01`, sampai: params.sampai || today,
    q: (params.q ?? "").trim().slice(0,120), masalah: params.masalah === "ya" ? "ya" : "" };
}
type Warehouse = { id: string; branch_id: string; code: string; name: string; type: string; is_active: boolean };
type Item = { id: string; code: string; name: string; unit: string; is_active: boolean };
type Stock = { warehouse_id: string; item_id: string; qty: Numeric };
type Layer = { warehouse_id: string; item_id: string; qty_left: Numeric; unit_cost: Numeric };
const matches = (q: string, values: string[]) => !q || values.some(value => value.toLocaleLowerCase("id-ID").includes(q.toLocaleLowerCase("id-ID")));

export async function loadInventoryReport(client: SupabaseClient, params: ReportParams) {
  const filters = normalizeReportFilters(params);
  const scope = await reportScope(client, REPORT_PATHS.inventory, filters.cabang);
  const warehouses = scope.branchIds.length ? await tableRows<Warehouse>(client, "warehouses", "id,branch_id,code,name,type,is_active", query => query.in("branch_id",scope.branchIds)) : [];
  if (filters.gudang && !warehouses.some(row => row.id === filters.gudang)) throw new ReportAccessError("Akses gudang ditolak", 403);
  const warehouseIds = warehouses.filter(row => !filters.gudang || row.id === filters.gudang).map(row => row.id);
  const [stock, layers] = warehouseIds.length ? await Promise.all([
    tableRows<Stock>(client,"stock","id,warehouse_id,item_id,qty", query => query.in("warehouse_id",warehouseIds)),
    tableRows<Layer>(client,"stock_layers","id,warehouse_id,item_id,qty_left,unit_cost", query => query.in("warehouse_id",warehouseIds).gt("qty_left",0)),
  ]) : [[],[]] as [Stock[],Layer[]];
  const values = valueInventory(stock.map(row => ({ warehouseId: row.warehouse_id, itemId: row.item_id, qty: row.qty })),
    layers.map(row => ({ warehouseId: row.warehouse_id, itemId: row.item_id, qtyLeft: row.qty_left, unitCost: row.unit_cost })));
  const items = await byIds<Item>(client,"items","id,code,name,unit,is_active","id",values.map(row => row.itemId));
  const itemMap = new Map(items.map(row => [row.id,row]));
  const warehouseMap = new Map(warehouses.map(row => [row.id,row]));
  const branchMap = new Map(scope.branches.map(row => [row.id,row.name]));
  const rows = values.map(row => {
    const item = itemMap.get(row.itemId), warehouse = warehouseMap.get(row.warehouseId);
    if (!item || !warehouse) throw new Error("Data laporan gagal dibaca: identitas barang atau gudang tidak tersedia");
    return { ...row, code: item.code, name: item.name, unit: item.unit, itemActive: item.is_active,
      warehouse: warehouse.name, warehouseCode: warehouse.code, warehouseType: warehouse.type, warehouseActive: warehouse.is_active,
      branchId: warehouse.branch_id, branch: branchMap.get(warehouse.branch_id) ?? warehouse.branch_id };
  }).filter(row => matches(filters.q,[row.code,row.name,row.warehouse,row.branch]) && (!filters.masalah || row.flags.length > 0))
    .sort((a,b) => a.branch.localeCompare(b.branch) || a.warehouse.localeCompare(b.warehouse) || a.name.localeCompare(b.name) || a.itemId.localeCompare(b.itemId));
  const incomplete = rows.filter(row => row.value === null).length;
  const pricedValue = rows.reduce((sum,row) => sum+row.pricedValue,0);
  return { scope, filters, warehouses, rows, readAt: new Date().toISOString(),
    summary: { count: rows.length, incomplete, pricedValue, value: incomplete ? null : pricedValue } };
}

type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>): T | null => Array.isArray(value) ? value[0] ?? null : value;
type InvoiceLine = {
  id: string; compound_recipe_id: string | null; deskripsi: string; qty: Numeric; harga: Numeric; diskon_persen: Numeric; hpp: Numeric;
  invoices: Rel<{ id: string; visit_id: string; invoice_no: string; created_at: string; paid_status: string;
    visits: Rel<{ branch_id: string; dokter: string | null; doctor_id: string | null }> }>;
};
type Recipe = { id: string; recipe_name: string; status: string };
type OfficialUsage = { recipe_id: string; formula_version_id: string };
type Version = { id: string; name: string; version: number; formula_id: string };
export async function loadCompoundReport(client: SupabaseClient, params: ReportParams) {
  const filters = normalizeReportFilters(params);
  const scope = await reportScope(client,REPORT_PATHS.compound,filters.cabang);
  if (!validReportDate(filters.dari) || !validReportDate(filters.sampai) || filters.dari > filters.sampai) throw new ReportInputError("Rentang tanggal tidak valid. Periksa tanggal awal dan akhir.");
  const { mulai, akhir } = batasTanggalWIB(filters.dari,filters.sampai);
  const lines = scope.branchIds.length ? await tableRows<InvoiceLine>(client,"invoice_items",
    "id,compound_recipe_id,deskripsi,qty,harga,diskon_persen,hpp,invoices!inner(id,visit_id,invoice_no,created_at,paid_status,voided_at,visits!inner(branch_id,dokter,doctor_id))",
    query => query.not("compound_recipe_id","is",null).is("invoices.voided_at",null)
      .in("invoices.visits.branch_id",scope.branchIds).gte("invoices.created_at",mulai).lte("invoices.created_at",akhir)) : [];
  const recipeIds = lines.flatMap(row => row.compound_recipe_id ? [row.compound_recipe_id] : []);
  const [recipes, usage] = await Promise.all([
    byIds<Recipe>(client,"compounding_recipes","id,recipe_name,status","id",recipeIds),
    byIds<OfficialUsage>(client,"compound_official_usage","recipe_id,formula_version_id","recipe_id",recipeIds,"recipe_id"),
  ]);
  const versions = await byIds<Version>(client,"compound_formula_versions","id,name,version,formula_id","id",usage.map(row => row.formula_version_id));
  const recipeMap = new Map(recipes.map(row => [row.id,row]));
  const usageMap = new Map(usage.map(row => [row.recipe_id,row.formula_version_id]));
  const versionMap = new Map(versions.map(row => [row.id,row]));
  const branchMap = new Map(scope.branches.map(row => [row.id,row.name]));
  const values = compoundSales(lines.map(line => {
    const invoice = one(line.invoices), visit = one(invoice?.visits ?? null);
    if (!invoice || !visit || !scope.branchIds.includes(visit.branch_id)) throw new Error("Data laporan gagal dibaca: cabang invoice tidak tersedia");
    const recipe = line.compound_recipe_id ? recipeMap.get(line.compound_recipe_id) : undefined;
    const formulaVersionId = line.compound_recipe_id ? usageMap.get(line.compound_recipe_id) ?? null : null;
    const version = formulaVersionId ? versionMap.get(formulaVersionId) : undefined;
    const doctor = visit.dokter?.trim() || "Belum tercatat";
    return { id: line.id, recipeId: line.compound_recipe_id, qty: line.qty, price: line.harga,
      discountPercent: line.diskon_persen ?? 0, hpp: line.hpp, name: line.deskripsi, recipeName: recipe?.recipe_name ?? line.deskripsi,
      formulaVersionId, version: version?.version ?? null, formulaName: version?.name ?? null,
      branchId: visit.branch_id, branch: branchMap.get(visit.branch_id) ?? visit.branch_id, doctor,
      doctorKey: visit.doctor_id || `nama:${doctor}`, createdAt: invoice.created_at,
      invoiceNo: invoice.invoice_no || "—", invoiceId: invoice.id, visitId: invoice.visit_id, paymentStatus: invoice.paid_status };
  }));
  const doctors = [...new Map(values.map(row => [row.doctorKey,{ id: row.doctorKey, name: row.doctor }])).values()].sort((a,b) => a.name.localeCompare(b.name));
  const rows = values.filter(row => (!filters.dokter || row.doctorKey === filters.dokter) && matches(filters.q,
    [row.name,row.recipeName,row.invoiceNo,row.branch,row.doctor,row.formulaName ?? "",row.formulaVersionId ?? ""]))
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return { scope, filters, rows, doctors, summary: compoundSummary(rows), readAt: new Date().toISOString() };
}

export type InventoryReport = Awaited<ReturnType<typeof loadInventoryReport>>;
export type CompoundReport = Awaited<ReturnType<typeof loadCompoundReport>>;
