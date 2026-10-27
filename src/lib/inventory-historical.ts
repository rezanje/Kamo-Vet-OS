import type { SupabaseClient } from "@supabase/supabase-js";
import Decimal from "decimal.js";
import { bolehBukaPath } from "./akses";
import { validReportDate } from "./hpp-reports";
import { readReportRows, ReportAccessError, ReportInputError } from "./hpp-reports-server";
import { hariIniWIB, tanggalWIB } from "./tanggal";

export const HISTORICAL_INVENTORY_PATH = "/laporan/nilai-persediaan/historis";
const Exact = Decimal.clone({ precision: 80 });
type Branch = { id: string; name: string };
type Warehouse = { id: string; branch_id: string; name: string; code: string };
type Item = { id: string; code: string; name: string; unit: string };
type CostEvent = {
  id: number | string; warehouse_id: string; item_id: string; tanggal: string;
  source: string; source_ref: string | null; qty_delta: number | string;
  value_delta: number | string | null; qty_after: number | string;
  value_after: number | string | null; average_after: number | string | null;
};
type InventoryJournalLine = {
  id: string; debit: number | string; credit: number | string;
  journal_entries: { branch_id: string | null } | { branch_id: string | null }[] | null;
};

function amount(value: number | string, label: string): Decimal {
  try {
    const number = new Exact(value);
    // Leave headroom for exact sums across report rows; never silently round
    // a PostgreSQL NUMERIC that exceeds the local arithmetic precision.
    if (number.isFinite() && number.sd() <= 70 && Math.abs(number.e) <= 60) return number;
  } catch { /* A bad source value must fail the whole report. */ }
  throw new ReportInputError(`${label} tidak sah dalam riwayat nilai persediaan.`);
}

function eventPositions(events: CostEvent[]) {
  const positions = new Map<string, { event: CostEvent; qty: Decimal; value: Decimal | null; complete: boolean; lastAverage: Decimal | null }>();
  for (const event of events) {
    const key = `${event.warehouse_id}:${event.item_id}`;
    const qty = amount(event.qty_after, "Qty");
    const delta = amount(event.qty_delta, "Perubahan qty");
    const value = event.value_after === null ? null : amount(event.value_after, "Nilai");
    const valueDelta = event.value_delta === null ? null : amount(event.value_delta, "Perubahan nilai");
    const previous = positions.get(key);
    const previousQty = previous?.qty ?? new Exact(0);
    if (!previousQty.plus(delta).eq(qty)) throw new ReportInputError("Riwayat qty persediaan tidak lengkap; periksa event sumber sebelum menarik nilai historis.");
    if (!previous && event.source === "average-activation" && (!qty.eq(delta) || (value && valueDelta && !value.eq(valueDelta)))) {
      throw new ReportInputError("Saldo aktivasi average tidak konsisten.");
    }
    // A first non-activation event is valid only when it starts from zero.
    // A missing activation seed or middle event must never become a plausible total.
    const knownPreviousValue = previous ? previous.value : new Exact(0);
    const monetaryLink = knownPreviousValue !== null && value !== null && valueDelta !== null && knownPreviousValue.plus(valueDelta).eq(value);
    if (knownPreviousValue !== null && value !== null && valueDelta !== null && !monetaryLink) {
      throw new ReportInputError("Riwayat nilai persediaan tidak lengkap; periksa event sumber sebelum menarik nilai historis.");
    }
    // A recorded zero position carries exactly zero value (the valuation trigger and
    // saved closing both take value_after as-is), so an earlier unknown cost no longer
    // blocks later values; continuity is checked strictly again from this zero.
    const knownZero = qty.isZero() && value !== null && value.isZero();
    // R04: last known moving-average cost for this position. The writer stores
    // nullif(average,0), so a NULL average next to a recorded value means:
    // - qty ≠ 0: a true zero average (value_after is then 0) → known 0;
    // - qty = 0: a reset with no average → nothing known any more (no stale carry-over).
    // Only a NULL average with an unknown value keeps the previous known average.
    const average = event.average_after === null ? null : amount(event.average_after, "HPP rata-rata");
    if (average !== null && average.isNegative()) throw new ReportInputError("HPP rata-rata negatif dalam riwayat nilai persediaan.");
    const lastAverage = average !== null ? average
      : value === null ? previous?.lastAverage ?? null
      : qty.isZero() ? null : new Exact(0);
    positions.set(key, { event, qty, value, complete: knownZero || ((previous?.complete ?? true) && monetaryLink), lastAverage });
  }
  return [...positions.values()];
}

async function inventoryLedgerAtDate(client: SupabaseClient, asOf: string, branchIds: string[], includeUnallocated: boolean) {
  const { data: account, error } = await client.from("coa_accounts").select("id").eq("code", "1301").maybeSingle();
  if (error) throw new Error(`Akun persediaan gagal dibaca: ${error.message}`);
  if (!account) return null;
  const lines: InventoryJournalLine[] = [];
  for (let start = 0; start < branchIds.length; start += 100) {
    const ids = branchIds.slice(start, start + 100);
    lines.push(...await readReportRows<InventoryJournalLine>(async (from, to) => client.from("journal_lines")
      .select("id,debit::text,credit::text,journal_entries!inner(tanggal,branch_id)", { count: "exact" })
      .eq("account_id", account.id).lte("journal_entries.tanggal", asOf)
      .in("journal_entries.branch_id", ids).order("id").range(from, to)));
  }
  if (includeUnallocated) {
    lines.push(...await readReportRows<InventoryJournalLine>(async (from, to) => client.from("journal_lines")
      .select("id,debit::text,credit::text,journal_entries!inner(tanggal,branch_id)", { count: "exact" })
      .eq("account_id", account.id).lte("journal_entries.tanggal", asOf)
      .is("journal_entries.branch_id", null).order("id").range(from, to)));
  }
  const balances = new Map(branchIds.map(id => [id, new Exact(0)]));
  let unallocated = new Exact(0);
  for (const line of lines) {
    const entry = Array.isArray(line.journal_entries) ? line.journal_entries[0] : line.journal_entries;
    if (!entry || (entry.branch_id !== null && typeof entry.branch_id !== "string")) throw new ReportInputError("Cabang jurnal persediaan tidak lengkap.");
    const debit = amount(line.debit, "Debit GL 1301");
    const credit = amount(line.credit, "Kredit GL 1301");
    if (debit.isNegative() || credit.isNegative()) throw new ReportInputError("Nilai jurnal persediaan negatif; rekonsiliasi sumber diperlukan.");
    const value = debit.minus(credit);
    if (entry.branch_id === null) unallocated = unallocated.plus(value);
    else if (balances.has(entry.branch_id)) balances.set(entry.branch_id, balances.get(entry.branch_id)!.plus(value));
  }
  return { balances, unallocated };
}

export async function loadHistoricalInventory(client: SupabaseClient, input: { tanggal?: string; cabang?: string[] } = {}) {
  const asOf = input.tanggal || hariIniWIB();
  if (!validReportDate(asOf) || asOf > hariIniWIB()) throw new ReportInputError("Tanggal as-of harus tanggal WIB yang valid dan tidak di masa depan.");
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new ReportAccessError("Sesi tidak ditemukan", 401);
  const { data: profile, error: profileError } = await client.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (profileError || !profile?.is_active || !["OWNER", "FINANCE"].includes(profile.role)) throw new ReportAccessError("Laporan nilai historis hanya untuk OWNER dan FINANCE aktif", 403);
  const modules = await readReportRows<{ role: string; module_id: string }>(async (from, to) => client.from("role_modules")
    .select("role,module_id", { count: "exact" }).order("role").order("module_id").range(from, to), row => `${row.role}:${row.module_id}`);
  if (!bolehBukaPath(profile.role, HISTORICAL_INVENTORY_PATH, modules)) throw new ReportAccessError("Akses modul laporan ditolak", 403);
  const canViewLedger = bolehBukaPath(profile.role, "/keuangan/buku-besar", modules);
  const allBranches = await readReportRows<Branch>(async (from, to) => client.from("branches").select("id,name", { count: "exact" }).order("id").range(from, to));
  const checked = await Promise.all(allBranches.map(async branch => {
    const { data, error } = await client.rpc("user_can_access_branch", { b: branch.id });
    if (error) throw new Error(`Akses cabang gagal dibaca: ${error.message}`);
    return data === true ? branch : null;
  }));
  const branches = checked.filter((branch): branch is Branch => branch !== null);
  const selectedIds = [...new Set(input.cabang ?? [])];
  if (selectedIds.some(id => !branches.some(branch => branch.id === id))) throw new ReportAccessError("Akses cabang laporan ditolak", 403);
  const selected = branches.filter(branch => !selectedIds.length || selectedIds.includes(branch.id));
  const { data: settings, error: settingsError } = await client.from("inventory_costing_settings").select("method,activated_at").eq("id", true).maybeSingle();
  if (settingsError) throw new Error(settingsError.message);
  const activatedAt = typeof settings?.activated_at === "string" ? tanggalWIB(settings.activated_at) : null;
  const available = settings?.method === "moving_average" && !!activatedAt && asOf >= activatedAt;
  if (!available) return { asOf, activatedAt, available: false as const, branches, selectedIds, selected, canViewLedger, rows: [], summary: [], total: null };

  const warehouses: Warehouse[] = [];
  for (let start = 0; start < selected.length; start += 100) {
    const ids = selected.slice(start, start + 100).map(branch => branch.id);
    warehouses.push(...await readReportRows<Warehouse>(async (from, to) => client.from("warehouses")
      .select("id,branch_id,name,code", { count: "exact" }).in("branch_id", ids).order("id").range(from, to)));
  }
  const events: CostEvent[] = [];
  for (let start = 0; start < warehouses.length; start += 100) {
    const ids = warehouses.slice(start, start + 100).map(warehouse => warehouse.id);
    events.push(...await readReportRows<CostEvent>(async (from, to) => client.from("inventory_cost_events")
      .select("id::text,warehouse_id,item_id,tanggal,source,source_ref,qty_delta::text,value_delta::text,qty_after::text,value_after::text,average_after::text", { count: "exact" })
      .in("warehouse_id", ids).lte("tanggal", asOf)
      .order("warehouse_id").order("item_id").order("tanggal").order("id").range(from, to), row => String(row.id ?? "")));
  }
  const positions = eventPositions(events);
  if (asOf === hariIniWIB()) {
    // Today's stock is an independent completeness check for a wholly missing
    // event stream. It cannot be used for an earlier date, when new stock may
    // legitimately have arrived only after that date.
    const known = new Map(positions.map(position => [`${position.event.warehouse_id}:${position.event.item_id}`, position.qty]));
    const seenStock = new Set<string>();
    for (let start = 0; start < warehouses.length; start += 100) {
      const ids = warehouses.slice(start, start + 100).map(warehouse => warehouse.id);
      const stock = await readReportRows<{ id: string; warehouse_id: string; item_id: string; qty: number | string }>(async (from, to) => client.from("stock")
        .select("id,warehouse_id,item_id,qty::text", { count: "exact" }).in("warehouse_id", ids).order("id").range(from, to));
      for (const row of stock) {
        const qty = amount(row.qty, "Qty stok");
        const key = `${row.warehouse_id}:${row.item_id}`;
        seenStock.add(key);
        const prior = known.get(key);
        if ((!qty.isZero() && prior === undefined) || (prior !== undefined && !prior.eq(qty))) {
          throw new ReportInputError("Event nilai persediaan tidak lengkap atau berbeda dari stok saat ini; rekonsiliasi sumber diperlukan.");
        }
      }
    }
    if (positions.some(position => !position.qty.isZero() && !seenStock.has(`${position.event.warehouse_id}:${position.event.item_id}`))) {
      throw new ReportInputError("Event nilai persediaan tidak memiliki saldo stok saat ini; rekonsiliasi sumber diperlukan.");
    }
  }
  const itemIds = [...new Set(positions.map(position => position.event.item_id))];
  const items: Item[] = [];
  for (let start = 0; start < itemIds.length; start += 100) {
    const ids = itemIds.slice(start, start + 100);
    items.push(...await readReportRows<Item>(async (from, to) => client.from("items")
      .select("id,code,name,unit", { count: "exact" }).in("id", ids).order("id").range(from, to)));
  }
  const warehouseMap = new Map(warehouses.map(warehouse => [warehouse.id, warehouse]));
  const itemMap = new Map(items.map(item => [item.id, item]));
  const branchMap = new Map(branches.map(branch => [branch.id, branch]));
  const rows = positions.map(position => {
    const event = position.event;
    const warehouse = warehouseMap.get(event.warehouse_id);
    const item = itemMap.get(event.item_id);
    const branch = warehouse && branchMap.get(warehouse.branch_id);
    if (!warehouse || !item || !branch) throw new ReportInputError("Identitas sumber nilai historis tidak lengkap.");
    const average = event.average_after === null ? null : amount(event.average_after, "HPP rata-rata").toFixed();
    const negative = position.qty.isNegative();
    // R04 policy for minus positions whose value chain is not provable:
    // 1. the event's own recorded value_after when present (flagged, unlinked);
    // 2. otherwise qty × the last known moving-average cost (flagged);
    // 3. otherwise unavailable. Positive positions keep the strict recorded-value rule.
    const lastAverage = position.lastAverage;
    let value: string | null = null;
    let valueBasis: "event" | "event-unlinked" | "last-average" | null = null;
    if (position.complete && position.value !== null) { value = position.value.toFixed(); valueBasis = "event"; }
    else if (negative && position.value !== null) { value = position.value.toFixed(); valueBasis = "event-unlinked"; }
    else if (negative && lastAverage !== null) { value = position.qty.times(lastAverage).toFixed(); valueBasis = "last-average"; }
    const estimated = valueBasis === "event-unlinked" || valueBasis === "last-average";
    return { id: `${event.warehouse_id}:${event.item_id}`, branchId: branch.id, branch: branch.name,
      warehouse: warehouse.name, warehouseCode: warehouse.code, item: item.name, itemCode: item.code, unit: item.unit,
      qty: position.qty.toFixed(), value, valueBasis, estimated, estimateAverage: valueBasis === "last-average" && lastAverage ? lastAverage.toFixed() : null,
      average, negative, source: event.source, sourceRef: event.source_ref, sourceDate: event.tanggal };
  }).sort((a, b) => a.branch.localeCompare(b.branch) || a.warehouse.localeCompare(b.warehouse) || a.item.localeCompare(b.item) || a.id.localeCompare(b.id));
  const fullBranchAccess = allBranches.length > 0 && branches.length === allBranches.length;
  const ledger = canViewLedger ? await inventoryLedgerAtDate(client, asOf, selected.map(branch => branch.id),
    fullBranchAccess && selected.length === branches.length) : null;
  const subtotal = (subset: typeof rows) => subset.some(row => row.value === null) ? null
    : subset.reduce((sum, row) => sum.plus(row.value!), new Exact(0)).toFixed();
  const summary = selected.map(branch => {
    const scoped = rows.filter(row => row.branchId === branch.id);
    const value = subtotal(scoped);
    const ledgerValue = ledger?.balances.get(branch.id)?.toFixed() ?? null;
    return { ...branch, count: scoped.length, value, ledgerValue,
      difference: value === null || ledgerValue === null ? null : new Exact(value).minus(ledgerValue).toFixed(),
      negativeCount: scoped.filter(row => row.negative).length, estimatedCount: scoped.filter(row => row.estimated).length,
      estimatedValue: scoped.filter(row => row.estimated).reduce((sum, row) => sum.plus(row.value ?? 0), new Exact(0)).toFixed() };
  });
  const total = subtotal(rows);
  const scopedLedgerValue = ledger ? selected.reduce((sum, branch) => sum.plus(ledger.balances.get(branch.id) ?? 0), new Exact(0)).toFixed() : null;
  return { asOf, activatedAt, available: true as const, branches, selectedIds, selected, canViewLedger, rows, summary, total,
    estimatedCount: summary.reduce((sum, branch) => sum + branch.estimatedCount, 0),
    estimatedValue: summary.reduce((sum, branch) => sum.plus(branch.estimatedValue), new Exact(0)).toFixed(),
    scopedLedgerValue, scopedDifference: total === null || scopedLedgerValue === null ? null : new Exact(total).minus(scopedLedgerValue).toFixed(),
    unallocatedLedger: ledger && fullBranchAccess && selected.length === branches.length ? ledger.unallocated.toFixed() : null, fullBranchAccess };
}
