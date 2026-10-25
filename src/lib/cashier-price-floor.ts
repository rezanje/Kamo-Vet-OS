import { lineSubtotal, type CartLine } from "./pos-calc";
import { PosDecimal } from "./pos-money";

type CashierLine = CartLine & { nama: string; item_type?: string; faktor?: number };
type CostLayer = { qty_left: number; unit_cost: number };
type InventoryLine = { item_id: string; item_type?: string; qty: number; faktor?: number };
type StockCostLine = InventoryLine & { group_components?: { item_type: string; component_item_id: string; total_base_qty: number }[] };

export function cashierStockCostEvents(lines: StockCostLine[]) {
  const events: (InventoryLine & { item_type: "Persediaan"; pricedLineIndex: number | null })[] = [];
  lines.forEach((line, index) => {
    if (line.item_type === "Persediaan" && line.item_id) events.push({ item_id: line.item_id, item_type: "Persediaan", qty: line.qty, faktor: line.faktor ?? 1, pricedLineIndex: index });
    if (line.item_type === "Grup") for (const component of line.group_components ?? []) {
      if (component.item_type === "Persediaan") events.push({ item_id: component.component_item_id, item_type: "Persediaan", qty: component.total_base_qty, faktor: 1, pricedLineIndex: null });
    }
  });
  return events;
}

/** Match the active FIFO take order; a known high cost safely covers shortages and zero-price layers. */
export function conservativeFifoCost(qtyBase: number, layers: CostLayer[], knownCost: number): number | null {
  if (!Number.isFinite(qtyBase) || qtyBase <= 0) return null;
  let remaining = new PosDecimal(qtyBase);
  let unpriced = new PosDecimal(0);
  let cost = new PosDecimal(0);
  for (const layer of layers) {
    if (remaining.lte(0)) break;
    if (!Number.isFinite(Number(layer.qty_left)) || !Number.isFinite(Number(layer.unit_cost)) || Number(layer.qty_left) < 0 || Number(layer.unit_cost) < 0) return null;
    const taken = PosDecimal.min(remaining, layer.qty_left);
    cost = cost.plus(taken.times(layer.unit_cost));
    if (Number(layer.unit_cost) === 0) unpriced = unpriced.plus(taken);
    remaining = remaining.minus(taken);
  }
  if (remaining.plus(unpriced).gt(0)) {
    if (!Number.isFinite(knownCost) || knownCost <= 0) return null;
    cost = cost.plus(remaining.plus(unpriced).times(knownCost));
  }
  return cost.toNumber();
}

/** Quote separate cart rows in posting order; the second row cannot reuse the first row's cheap layer. */
export function quoteCashierLineCosts(
  lines: InventoryLine[], layers: (CostLayer & { item_id: string })[], knownCosts: Map<string, number>,
): (number | null)[] {
  const queues = new Map<string, CostLayer[]>();
  for (const layer of layers) {
    const queue = queues.get(layer.item_id) ?? [];
    queue.push({ qty_left: Number(layer.qty_left), unit_cost: Number(layer.unit_cost) });
    queues.set(layer.item_id, queue);
  }
  return lines.map(line => {
    if (line.item_type !== "Persediaan" || !line.item_id) return null;
    const qtyBase = new PosDecimal(line.qty).times(line.faktor ?? 1).toNumber();
    const queue = queues.get(line.item_id) ?? [];
    const cost = conservativeFifoCost(qtyBase, queue, knownCosts.get(line.item_id) ?? 0);
    let remaining = qtyBase;
    for (const layer of queue) {
      const taken = Math.min(remaining, layer.qty_left);
      layer.qty_left -= taken;
      remaining -= taken;
      if (remaining <= 0) break;
    }
    return cost;
  });
}

/** Total-level discounts, voucher and points are allocated by each line's share after item discounts. */
export function cashierPriceFloorIssue(lines: CashierLine[], netTotal: number, fifoLineCosts: (number | null)[]): string | null {
  if (!Number.isFinite(netTotal) || netTotal < 0 || fifoLineCosts.length !== lines.length) return "Harga neto atau HPP aktif tidak dapat diverifikasi.";
  const lineNets = lines.map(lineSubtotal);
  const afterItems = lineNets.reduce((sum, value) => sum.plus(value), new PosDecimal(0));
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.item_type !== "Persediaan") continue;
    const name = line.nama || "Barang persediaan";
    const lineNet = new PosDecimal(lineNets[index]);
    const effectiveNet = afterItems.gt(0) ? lineNet.times(netTotal).div(afterItems) : new PosDecimal(0);
    if (!effectiveNet.isFinite() || effectiveNet.lte(0)) return `Harga neto ${name} nol; penjualan Persediaan ditolak.`;
    const hpp = fifoLineCosts[index];
    if (hpp == null || !Number.isFinite(hpp) || hpp < 0) return `HPP aktif ${name} belum dapat diverifikasi; penjualan ditolak.`;
    if (effectiveNet.lt(hpp)) return `Harga neto ${name} di bawah batas aman HPP FIFO; penjualan ditolak.`;
  }
  return null;
}
