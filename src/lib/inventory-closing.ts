import type { SupabaseClient } from "@supabase/supabase-js";
import Decimal from "decimal.js";
import { bolehBukaPath } from "./akses";
import { inventoryMethod, readReportRows, ReportAccessError } from "./hpp-reports-server";

export const INVENTORY_CLOSING_PATH = "/keuangan/closing-hpp";
type Close = { id: string; period: string; closed_through: string; closed_at: string };
type Value = { close_id: string; warehouse_id: string; item_id: string; qty: number | string; average_cost: number | string | null; value: number | string | null };
type InventoryJournalLine = { id: string; debit: number | string; credit: number | string; journal_entries: { branch_id: string | null } | { branch_id: string | null }[] | null };

function finiteMoney(value: number | string): Decimal {
  const amount = new Decimal(value);
  if (!amount.isFinite() || amount.isNegative()) throw new Error("Nilai jurnal persediaan tidak sah; rekonsiliasi diperlukan.");
  return amount;
}

async function inventoryLedgerAtClose(client: SupabaseClient, close: Close, branchIds: string[]) {
  const { data: account, error } = await client.from("coa_accounts").select("id").eq("code", "1301").maybeSingle();
  if (error) throw new Error(`Akun persediaan gagal dibaca: ${error.message}`);
  if (!account) return null;
  const lines = await readReportRows<InventoryJournalLine>(async (from, to) => client.from("journal_lines")
    .select("id,debit,credit,journal_entries!inner(tanggal,branch_id)", { count: "exact" })
    .eq("account_id", account.id).lte("journal_entries.tanggal", close.closed_through)
    .order("id").range(from, to));
  const balances = new Map(branchIds.map(id => [id, new Decimal(0)]));
  let unallocated = new Decimal(0);
  for (const line of lines) {
    const entry = Array.isArray(line.journal_entries) ? line.journal_entries[0] : line.journal_entries;
    if (!entry || (entry.branch_id !== null && typeof entry.branch_id !== "string")) throw new Error("Cabang jurnal persediaan tidak lengkap; rekonsiliasi diperlukan.");
    const amount = finiteMoney(line.debit).minus(finiteMoney(line.credit));
    if (entry.branch_id === null) unallocated = unallocated.plus(amount);
    else if (balances.has(entry.branch_id)) balances.set(entry.branch_id, balances.get(entry.branch_id)!.plus(amount));
  }
  return { balances, unallocated: unallocated.toNumber() };
}

function snapshotTotal(values: Value[]): number | null {
  try {
    let sum = new Decimal(0);
    for (const row of values) {
      if (row.value === null) return null;
      const value = new Decimal(row.value);
      if (!value.isFinite()) return null;
      sum = sum.plus(value);
    }
    const result = sum.toNumber();
    return Number.isFinite(result) ? result : null;
  } catch { return null; }
}

export async function loadInventoryClosing(client: SupabaseClient, selectedClose?: string, selectedBranches: string[] = []) {
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new ReportAccessError("Sesi tidak ditemukan", 401);
  const { data: profile, error: profileError } = await client.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (profileError || !profile?.is_active || !["OWNER", "FINANCE"].includes(profile.role)) throw new ReportAccessError("Closing HPP hanya tersedia untuk OWNER dan FINANCE aktif", 403);
  const modules = await readReportRows<{ role: string; module_id: string }>(async (from, to) => {
    const result = await client.from("role_modules").select("role,module_id", { count: "exact" }).order("role").order("module_id").range(from, to);
    return result;
  }, row => `${row.role}:${row.module_id}`);
  if (!bolehBukaPath(profile.role, INVENTORY_CLOSING_PATH, modules)) throw new ReportAccessError("Akses modul buku besar ditolak", 403);
  const branches = await readReportRows<{ id: string; name: string }>(async (from, to) => client.from("branches").select("id,name", { count: "exact" }).order("id").range(from, to));
  const allowed = await Promise.all(branches.map(async branch => {
    const { data, error } = await client.rpc("user_can_access_branch", { b: branch.id });
    if (error) throw new Error(`Akses cabang gagal dibaca: ${error.message}`);
    return data === true ? branch : null;
  }));
  const availableBranches = allowed.filter((branch): branch is typeof branches[number] => branch !== null);
  const selectedBranchIds = [...new Set(selectedBranches)];
  if (selectedBranchIds.some(id => !availableBranches.some(branch => branch.id === id))) throw new ReportAccessError("Akses cabang snapshot ditolak", 403);
  const reportBranches = availableBranches.filter(branch => !selectedBranchIds.length || selectedBranchIds.includes(branch.id));
  const warehouses = reportBranches.length ? await readReportRows<{ id: string; branch_id: string; name: string }>(async (from, to) => client.from("warehouses").select("id,branch_id,name", { count: "exact" }).in("branch_id", reportBranches.map(branch => branch.id)).order("id").range(from, to)) : [];
  const method = await inventoryMethod(client);
  const { data: settings, error: settingsError } = await client.from("inventory_costing_settings").select("activated_at").eq("id", true).maybeSingle();
  if (settingsError) throw new Error(settingsError.message);
  const closes = await readReportRows<Close>(async (from, to) => client.from("inventory_month_closes").select("id,period,closed_through,closed_at", { count: "exact" }).order("id").range(from, to));
  if (selectedClose && !closes.some(close => close.id === selectedClose)) throw new Error("Snapshot yang dipilih tidak tersedia; pilih ulang periode tersimpan.");
  const snapshots = warehouses.length && closes.length ? await readReportRows<Value>(async (from, to) => client.from("inventory_month_values").select("close_id,warehouse_id,item_id,qty,average_cost,value", { count: "exact" }).in("warehouse_id", warehouses.map(warehouse => warehouse.id)).order("close_id").order("warehouse_id").order("item_id").range(from, to), row => `${row.close_id}:${row.warehouse_id}:${row.item_id}`) : [];
  const warehouseMap = new Map(warehouses.map(warehouse => [warehouse.id, warehouse]));
  const branchMap = new Map(availableBranches.map(branch => [branch.id, branch.name]));
  const history = closes.map(close => {
    const values = snapshots.filter(value => value.close_id === close.id);
    return { ...close, scopedCount: values.length, scopedValue: snapshotTotal(values) };
  }).sort((a, b) => b.period.localeCompare(a.period));
  const activeClose = history.find(close => close.id === selectedClose) ?? history[0];
  const activeValues = snapshots.filter(value => value.close_id === activeClose?.id);
  const ledger = activeClose ? await inventoryLedgerAtClose(client, activeClose, reportBranches.map(branch => branch.id)) : null;
  const itemIds = [...new Set(activeValues.map(value => value.item_id))];
  const items: { id: string; code: string; name: string; unit: string }[] = [];
  for (let start = 0; start < itemIds.length; start += 100) {
    const ids = itemIds.slice(start, start + 100);
    items.push(...await readReportRows<typeof items[number]>(async (from, to) => client.from("items").select("id,code,name,unit", { count: "exact" }).in("id", ids).order("id").range(from, to)));
  }
  const itemMap = new Map(items.map(item => [item.id, item]));
  const values = activeValues.map(value => {
    const warehouse = warehouseMap.get(value.warehouse_id)!;
    const item = itemMap.get(value.item_id);
    return { ...value, warehouse: warehouse.name, branch: branchMap.get(warehouse.branch_id) ?? warehouse.branch_id, code: item?.code ?? value.item_id, item: item?.name ?? value.item_id, unit: item?.unit ?? "" };
  });
  const branchSummary = reportBranches.map(branch => {
    const scoped = activeValues.filter(value => warehouseMap.get(value.warehouse_id)?.branch_id === branch.id);
    const value = snapshotTotal(scoped);
    const ledgerValue = ledger?.balances.get(branch.id)?.toNumber() ?? null;
    return { ...branch, count: scoped.length, value, ledgerValue,
      difference: value === null || ledgerValue === null ? null : new Decimal(value).minus(ledgerValue).toNumber() };
  });
  const scopedLedgerValue = ledger ? reportBranches.reduce((sum, branch) => sum.plus(ledger.balances.get(branch.id) ?? 0), new Decimal(0)).toNumber() : null;
  const scopedDifference = activeClose?.scopedValue === null || activeClose?.scopedValue === undefined || scopedLedgerValue === null
    ? null : new Decimal(activeClose.scopedValue).minus(scopedLedgerValue).toNumber();
  return { method, activatedAt: (settings?.activated_at as string | null | undefined) ?? null, branches: availableBranches, selectedBranchIds, branchSummary,
    scopedLedgerValue, scopedDifference, unallocatedLedger: ledger?.unallocated ?? null,
    allBranches: branches.length > 0 && availableBranches.length === branches.length, history, activeClose, values };
}
