import type { SupabaseClient } from "@supabase/supabase-js";
import { bolehBukaPath } from "./akses";
import { inventoryMethod, readReportRows, ReportAccessError } from "./hpp-reports-server";

export const INVENTORY_CLOSING_PATH = "/keuangan/closing-hpp";
type Close = { id: string; period: string; closed_through: string; closed_at: string };
type Value = { close_id: string; warehouse_id: string; item_id: string; qty: number | string; average_cost: number | string | null; value: number | string | null };

export async function loadInventoryClosing(client: SupabaseClient, selectedClose?: string) {
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
  const warehouses = availableBranches.length ? await readReportRows<{ id: string; branch_id: string; name: string }>(async (from, to) => client.from("warehouses").select("id,branch_id,name", { count: "exact" }).in("branch_id", availableBranches.map(branch => branch.id)).order("id").range(from, to)) : [];
  const method = await inventoryMethod(client);
  const { data: settings, error: settingsError } = await client.from("inventory_costing_settings").select("activated_at").eq("id", true).maybeSingle();
  if (settingsError) throw new Error(settingsError.message);
  const closes = await readReportRows<Close>(async (from, to) => client.from("inventory_month_closes").select("id,period,closed_through,closed_at", { count: "exact" }).order("id").range(from, to));
  const snapshots = warehouses.length && closes.length ? await readReportRows<Value>(async (from, to) => client.from("inventory_month_values").select("close_id,warehouse_id,item_id,qty,average_cost,value", { count: "exact" }).in("warehouse_id", warehouses.map(warehouse => warehouse.id)).order("close_id").order("warehouse_id").order("item_id").range(from, to), row => `${row.close_id}:${row.warehouse_id}:${row.item_id}`) : [];
  const warehouseMap = new Map(warehouses.map(warehouse => [warehouse.id, warehouse]));
  const branchMap = new Map(availableBranches.map(branch => [branch.id, branch.name]));
  const history = closes.map(close => {
    const values = snapshots.filter(value => value.close_id === close.id);
    return { ...close, scopedCount: values.length, scopedValue: values.some(value => value.value === null || !Number.isFinite(Number(value.value))) ? null : values.reduce((sum, value) => sum + Number(value.value), 0) };
  }).sort((a, b) => b.period.localeCompare(a.period));
  const activeClose = history.find(close => close.id === selectedClose) ?? history[0];
  const activeValues = snapshots.filter(value => value.close_id === activeClose?.id);
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
  return { method, activatedAt: (settings?.activated_at as string | null | undefined) ?? null, branches: availableBranches, allBranches: branches.length > 0 && availableBranches.length === branches.length, history, activeClose, values };
}
