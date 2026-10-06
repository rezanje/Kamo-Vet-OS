export type Numeric = number | string | null;
export type Balance = { warehouseId: string; itemId: string; qty: Numeric };
export type CostLayer = { warehouseId: string; itemId: string; qtyLeft: Numeric; unitCost: Numeric };
export type InventoryValue = {
  warehouseId: string; itemId: string; stockQty: number | null; layerQty: number;
  difference: number | null; unpricedQty: number; pricedValue: number;
  value: number | null; averageCost: number | null; flags: string[];
};
export type CompoundLine = { id: string; recipeId: string | null; qty: Numeric; price: Numeric; discountPercent: Numeric; hpp: Numeric };
export type CompoundValue<T extends CompoundLine = CompoundLine> = T & { revenue: number; cost: number | null; grossProfit: number | null; margin: number | null };
const numeric = (value: Numeric): number | null => value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export function valueInventory(balances: Balance[], layers: CostLayer[]): InventoryValue[] {
  const groups = new Map<string, InventoryValue>();
  const group = (warehouseId: string, itemId: string) => {
    const key = `${warehouseId}:${itemId}`;
    if (!groups.has(key)) groups.set(key, { warehouseId, itemId, stockQty: null, layerQty: 0,
      difference: null, unpricedQty: 0, pricedValue: 0, value: null, averageCost: null, flags: [] });
    return groups.get(key)!;
  };
  for (const balance of balances) {
    const row = group(balance.warehouseId, balance.itemId);
    row.stockQty = numeric(balance.qty);
    if (row.stockQty === null) row.flags.push("Qty stok tidak valid");
  }
  for (const layer of layers) {
    const qty = numeric(layer.qtyLeft);
    if (qty === 0) continue;
    const row = group(layer.warehouseId, layer.itemId);
    if (qty === null || qty < 0) { row.flags.push("Qty lapisan tidak valid"); continue; }
    row.layerQty += qty;
    const cost = numeric(layer.unitCost);
    if (cost === null || cost <= 0 || !Number.isFinite(qty * cost) || !Number.isFinite(row.pricedValue + qty * cost)) row.unpricedQty += qty;
    else row.pricedValue += qty * cost;
  }
  return [...groups.values()].map(row => {
    if (row.stockQty === null) row.flags.push("Saldo stok tidak tersedia");
    else {
      row.difference = row.stockQty - row.layerQty;
      const precision = Number.EPSILON * Math.max(1,Math.abs(row.stockQty),Math.abs(row.layerQty)) * 8;
      if (Math.abs(row.difference) <= precision) row.difference = 0;
      if (row.difference !== 0) row.flags.push("Selisih stok/lapisan");
      if (row.stockQty < 0) row.flags.push("Stok negatif");
    }
    if (row.unpricedQty > 0) row.flags.push("HPP lapisan belum tersedia");
    if (row.flags.length === 0) {
      row.value = row.pricedValue;
      row.averageCost = row.layerQty > 0 ? row.value / row.layerQty : null;
    }
    row.flags = [...new Set(row.flags)];
    return row;
  });
}

export function compoundSales<T extends CompoundLine>(lines: T[]): CompoundValue<T>[] {
  return lines.filter(line => line.recipeId !== null).map(line => {
    const qty = numeric(line.qty), price = numeric(line.price), discount = numeric(line.discountPercent);
    if (qty === null || qty <= 0 || price === null || price < 0 || discount === null) {
      throw new Error("Nilai baris racikan tidak valid; laporan tidak dapat dihitung lengkap.");
    }
    const revenue = money(qty * price * (1 - Math.min(100, Math.max(0, discount)) / 100));
    if (!Number.isFinite(revenue)) throw new Error("Nilai baris racikan tidak valid; laporan tidak dapat dihitung lengkap.");
    const hpp = numeric(line.hpp);
    const cost = hpp !== null && hpp > 0 ? hpp : null;
    const grossProfit = cost === null ? null : money(revenue - cost);
    return { ...line, revenue, cost, grossProfit, margin: grossProfit !== null && revenue > 0 ? grossProfit / revenue * 100 : null };
  });
}

export function compoundSummary(rows: CompoundValue[]) {
  const covered = rows.filter(row => row.cost !== null);
  const revenue = money(rows.reduce((sum, row) => sum + row.revenue, 0));
  const coveredRevenue = money(covered.reduce((sum, row) => sum + row.revenue, 0));
  const cost = covered.length ? money(covered.reduce((sum, row) => sum + row.cost!, 0)) : null;
  const grossProfit = cost === null ? null : money(coveredRevenue - cost);
  return { revenue, coveredRevenue, cost, grossProfit,
    margin: grossProfit !== null && coveredRevenue > 0 ? grossProfit / coveredRevenue * 100 : null,
    missingCost: rows.length - covered.length, qty: rows.reduce((sum, row) => sum + Number(row.qty), 0) };
}

export function validReportDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function paginateReport<T>(rows: T[], input?: string): { rows: T[]; page: number; pages: number } {
  const requested = Number(input);
  const pages = Math.max(1, Math.ceil(rows.length / 100));
  const page = Math.min(pages, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
  return { rows: rows.slice((page - 1) * 100, page * 100), page, pages };
}
