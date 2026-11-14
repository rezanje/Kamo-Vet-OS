/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  defaultAlertSettings,
  evaluateAlerts,
  type AlertEvaluation,
  type AlertMetric,
  type AlertSetting,
} from "./operational-alerts";
import {
  collectDashboard,
  resolveDashboardScope,
  type DashboardData,
  type DashboardScope,
  type DashboardBlock,
} from "./operation-sales-server";
import type { DashboardFilter } from "./operation-sales";

type AnyClient = any;

export type OperationalAlertData = {
  scope: DashboardScope;
  settings: AlertSetting[];
  evaluation: AlertEvaluation;
};

function dateValue(value: string): number {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).getTime();
}

function settingRows(rows: any[]): AlertSetting[] {
  return rows.map((row) => ({
    ruleKey: row.rule_key,
    branchId: row.branch_id ?? null,
    threshold: row.threshold === null || row.threshold === undefined ? null : Number(row.threshold),
    periodDays: row.period_days === null || row.period_days === undefined ? null : Number(row.period_days),
    active: row.active === true,
    severity: row.severity === "yellow" ? "yellow" : "red",
  }));
}

async function read(query: AnyClient) {
  return await query;
}

function throwQueryError(result: any): void {
  if (!result.error) return;
  const error = new Error(result.error.message);
  (error as Error & { code?: string }).code = result.error.code;
  throw error;
}

function missingError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703" || code === "PGRST204";
}

function alertMetric(
  ruleKey: AlertMetric["ruleKey"],
  branch: { id: string; name: string },
  filter: DashboardFilter,
  values: { actual?: number; stockQty?: number; reason?: string; detail?: string; detailUrl?: string } | null,
): AlertMetric {
  return values === null
    ? {
      ruleKey, branchId: branch.id, branchName: branch.name, status: "missing",
      reason: "Data sumber belum tersedia", periodLabel: `${filter.from} sampai ${filter.to}`,
      detailUrl: "/pos/stok",
    }
    : {
      ruleKey, branchId: branch.id, branchName: branch.name,
      status: values.actual === undefined ? "missing" : "ready",
      actual: values.actual, stockQty: values.stockQty, reason: values.reason,
      ...(values.detail ? { detail: values.detail } : {}),
      periodLabel: `${filter.from} sampai ${filter.to}`, detailUrl: values.detailUrl ?? "/pos/stok",
    };
}

type OpnameMinus = { hpp: number; jual: number; documents: number; withoutValue: number };
const OPNAME_ALERT_LIMIT = 1000;
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/**
 * F2 (meeting 12 Nov 2026): nilai selisih KURANG stok opname per cabang pada periode alert, dari snapshot posting
 * (RPC read_opname_price_recap, F1). Hanya OWNER/FINANCE yang boleh membaca nilai HPP — peran lain mendapat alasan "missing",
 * bukan angka. Aktual alert = nilai HPP kurang (beban selisih stok yang dijurnal); harga jual ditampilkan sebagai keterangan.
 */
async function opnameMinusPerBranch(
  supabase: AnyClient,
  warehouses: { id: string; branch_id: string }[],
  filter: DashboardFilter,
): Promise<{ values: Map<string, OpnameMinus> } | { reason: string }> {
  if (!warehouses.length) return { values: new Map() };
  const results = await read(supabase.from("opname_results")
    .select("id,opname_orders!inner(warehouse_id)")
    .in("opname_orders.warehouse_id", warehouses.map((row) => row.id))
    .gte("tanggal", filter.from).lte("tanggal", filter.to)
    .order("id").limit(OPNAME_ALERT_LIMIT));
  throwQueryError(results);
  const rows = (results.data ?? []) as { id: string; opname_orders: { warehouse_id: string } | { warehouse_id: string }[] | null }[];
  if (rows.length >= OPNAME_ALERT_LIMIT) return { reason: "Terlalu banyak hasil opname pada periode ini; persempit periode" };
  const branchOf = new Map(warehouses.map((row) => [row.id, row.branch_id]));
  const resultBranch = new Map<string, string>();
  for (const row of rows) {
    const order = Array.isArray(row.opname_orders) ? row.opname_orders[0] : row.opname_orders;
    const branch = order ? branchOf.get(order.warehouse_id) : undefined;
    if (branch) resultBranch.set(row.id, branch);
  }
  const values = new Map<string, OpnameMinus>();
  if (!resultBranch.size) return { values };
  const recap = await supabase.rpc("read_opname_price_recap", { p_result_ids: [...resultBranch.keys()] });
  if (recap.error) {
    const code = String(recap.error.code ?? "");
    if (code === "42501") return { reason: "Nilai HPP hasil opname hanya untuk Owner/Finance" };
    if (code === "PGRST202" || code === "42883") return { reason: "Rekap nilai hasil opname belum aktif" };
    return { reason: "Nilai hasil opname belum dapat dibaca" };
  }
  if (!Array.isArray(recap.data)) return { reason: "Nilai hasil opname belum dapat dibaca" };
  for (const raw of recap.data as { result_id?: string; snapshot?: boolean; minus_modal?: string; minus_jual?: string; minus_count?: number; modal_missing?: number }[]) {
    const branch = raw?.result_id ? resultBranch.get(raw.result_id) : undefined;
    if (!branch) continue;
    const acc = values.get(branch) ?? { hpp: 0, jual: 0, documents: 0, withoutValue: 0 };
    acc.documents++;
    const hpp = Number(raw.minus_modal), jual = Number(raw.minus_jual);
    if (!raw.snapshot || Number(raw.modal_missing) > 0 || !Number.isFinite(hpp) || !Number.isFinite(jual)) acc.withoutValue++;
    else { acc.hpp += Math.abs(hpp); acc.jual += Math.abs(jual); }
    values.set(branch, acc);
  }
  return { values };
}

async function stockMetrics(supabase: AnyClient, scope: DashboardScope, filter: DashboardFilter): Promise<AlertMetric[]> {
  const warehouseResult = await read(supabase.from("warehouses").select("id,branch_id").in("branch_id", scope.branchIds).eq("is_active", true));
  throwQueryError(warehouseResult);
  const warehouses = (warehouseResult.data ?? []) as { id: string; branch_id: string }[];
  const warehouseIds = warehouses.map((row) => row.id);
  const [stockResult, layerResult] = await Promise.all([
    read(supabase.from("stock").select("warehouse_id,item_id,qty").in("warehouse_id", warehouseIds).lte("updated_at", `${filter.to}T23:59:59.999+07:00`)),
    read(supabase.from("stock_layers").select("warehouse_id,item_id,qty_left,exp_date").in("warehouse_id", warehouseIds).gt("qty_left", 0).not("exp_date", "is", null).lte("tanggal", filter.to)),
  ]);
  throwQueryError(stockResult);
  throwQueryError(layerResult);

  const opnameMinus = await opnameMinusPerBranch(supabase, warehouses, filter);

  const branchWarehouse = new Map<string, string>();
  for (const warehouse of warehouses) branchWarehouse.set(warehouse.id, warehouse.branch_id);
  const metrics: AlertMetric[] = [];
  for (const branch of scope.branches) {
    const branchStock = (stockResult.data ?? []).filter((row: any) => branchWarehouse.get(row.warehouse_id) === branch.id);
    const negative = branchStock.map((row: any) => Number(row.qty) || 0).filter((qty: number) => qty < 0);
    metrics.push(alertMetric("negative_stock", branch, filter, { actual: negative.length ? Math.min(...negative) : 0, detailUrl: "/pos/stok" }));

    const expiry: { days: number; qty: number }[] = (layerResult.data ?? [])
      .filter((row: any) => branchWarehouse.get(row.warehouse_id) === branch.id && Number(row.qty_left) > 0)
      .map((row: any) => ({ days: Math.floor((dateValue(String(row.exp_date)) - dateValue(filter.to)) / 86_400_000), qty: Number(row.qty_left) || 0 }))
    .sort(
      (a: { days: number; qty: number }, b: { days: number; qty: number }) =>
        a.days - b.days,
    );
    metrics.push(alertMetric("expired_or_near_expiry", branch, filter, expiry.length
      ? { actual: expiry[0].days, stockQty: expiry[0].qty, detailUrl: "/pos/expired" }
      : { actual: 0, stockQty: 0, detailUrl: "/pos/expired" }));

    // F2: selisih KURANG opname (HPP yang dijurnal) dibanding ambang pengaturan (bawaan Rp500.000).
    if ("reason" in opnameMinus) {
      metrics.push(alertMetric("stock_opname_variance", branch, filter, { reason: opnameMinus.reason }));
    } else {
      const minus = opnameMinus.values.get(branch.id) ?? { hpp: 0, jual: 0, documents: 0, withoutValue: 0 };
      const notes = minus.documents
        ? [`Selisih kurang harga jual ${rp(minus.jual)}`, `${minus.documents} dokumen opname`]
          .concat(minus.withoutValue ? [`${minus.withoutValue} dokumen tanpa nilai (opname lama)`] : [])
        : [];
      metrics.push(alertMetric("stock_opname_variance", branch, filter, {
        actual: minus.hpp,
        detail: notes.length ? notes.join(" · ") : undefined,
        detailUrl: "/laporan/hasil-opname",
      }));
    }
  }
  return metrics;
}

export async function collectOperationalAlerts(
  supabase: AnyClient,
  filter: DashboardFilter,
  existingDashboard?: DashboardData,
): Promise<OperationalAlertData> {
  const dashboard = existingDashboard ?? await collectDashboard(supabase, filter);
  const scope = existingDashboard?.scope ?? await resolveDashboardScope(supabase, filter.branchIds);
  const settingResult = await read(supabase.from("operational_alert_settings").select("rule_key,branch_id,threshold,period_days,active,severity"));
  throwQueryError(settingResult);
  const settings = settingRows(settingResult.data ?? []);
  const effectiveSettings = settings.length ? settings : defaultAlertSettings();
  const metrics: AlertMetric[] = [];

  for (const branch of scope.branches) {
    const branchSales = dashboard.sales.status === "ready"
      ? dashboard.sales.data.branches.find((row) => row.branchId === branch.id)
      : null;
    const achievement = branchSales?.achievement;
    metrics.push(achievement === null || achievement === undefined
      ? alertMetric("sales_below_target", branch, filter, { reason: "Target sales belum tersedia" })
      : alertMetric("sales_below_target", branch, filter, { actual: achievement, detailUrl: "/laporan/penjualan-rinci" }));
    metrics.push(alertMetric("sales_drop", branch, filter, { reason: "Data periode pembanding belum tersedia" }));
  }

  metrics.push(...await stockMetrics(supabase, scope, filter));
  const evaluation = evaluateAlerts(metrics, effectiveSettings);
  return { scope, settings: effectiveSettings, evaluation };
}

export async function collectOperationalAlertBlock(
  supabase: AnyClient,
  filter: DashboardFilter,
  existingDashboard?: DashboardData,
): Promise<DashboardBlock<AlertEvaluation>> {
  try {
    return { status: "ready", data: (await collectOperationalAlerts(supabase, filter, existingDashboard)).evaluation };
  } catch (error) {
    if (missingError(error)) return { status: "missing", reason: "Data alert belum lengkap" };
    const cryptoApi = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto : null;
    return { status: "error", correlationId: cryptoApi?.randomUUID() ?? `alert-${Date.now()}` };
  }
}
