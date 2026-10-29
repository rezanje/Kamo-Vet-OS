import { lineSubtotal, type CartLine } from "./pos-calc";
import { PosDecimal } from "./pos-money";

type GroupComponent = { item_type: string };
type CashierLine = CartLine & { nama: string; item_type?: string; faktor?: number; group_components?: GroupComponent[] | null };
type CostLayer = { qty_left: number; unit_cost: number };
type InventoryLine = { item_id: string; item_type?: string; qty: number; faktor?: number };
type StockCostLine = InventoryLine & { group_components?: { item_type: string; component_item_id: string; total_base_qty: number }[] };

/**
 * P03: barang yang dikunci harga minimumnya = Persediaan, atau paket Grup yang berisi
 * komponen Persediaan (dinilai terhadap jumlah HPP komponennya). Jasa tetap boleh gratis.
 */
export function isPriceFloorGoods(line: { item_type?: string; group_components?: GroupComponent[] | null }): boolean {
  return line.item_type === "Persediaan"
    || (line.item_type === "Grup" && (line.group_components ?? []).some(component => component.item_type === "Persediaan"));
}

export function cashierStockCostEvents(lines: StockCostLine[]) {
  const events: (InventoryLine & { item_type: "Persediaan"; pricedLineIndex: number | null; costLineIndex: number })[] = [];
  lines.forEach((line, index) => {
    if (line.item_type === "Persediaan" && line.item_id) events.push({ item_id: line.item_id, item_type: "Persediaan", qty: line.qty, faktor: line.faktor ?? 1, pricedLineIndex: index, costLineIndex: index });
    if (line.item_type === "Grup") for (const component of line.group_components ?? []) {
      if (component.item_type === "Persediaan") events.push({ item_id: component.component_item_id, item_type: "Persediaan", qty: component.total_base_qty, faktor: 1, pricedLineIndex: null, costLineIndex: index });
    }
  });
  return events;
}

/** Per cart line: its own FIFO cost, or the summed cost of a Grup's stock components; null when unknown. */
export function cashierLineCosts(lineCount: number, events: { costLineIndex: number }[], eventCosts: (number | null)[]): (number | null)[] {
  const sums: (InstanceType<typeof PosDecimal> | null | undefined)[] = Array.from({ length: lineCount }, () => undefined);
  events.forEach((event, index) => {
    const current = sums[event.costLineIndex];
    if (current === null) return;
    const cost = eventCosts[index];
    sums[event.costLineIndex] = cost == null || !Number.isFinite(cost) ? null : (current ?? new PosDecimal(0)).plus(cost);
  });
  return sums.map(sum => (sum == null ? null : sum.toNumber()));
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

export type PriceFloorFinding = { index: number; nama: string; paket: boolean; kind: "zero" | "unknown" | "below"; net: number; hpp: number | null };

/** Every goods line whose net (after item and allocated basket discounts) is zero, of unknown cost, or below HPP. */
export function priceFloorFindings(lines: CashierLine[], netTotal: number, lineCosts: (number | null)[]): PriceFloorFinding[] {
  const lineNets = lines.map(lineSubtotal);
  const afterItems = lineNets.reduce((sum, value) => sum.plus(value), new PosDecimal(0));
  const findings: PriceFloorFinding[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!isPriceFloorGoods(line)) continue;
    const paket = line.item_type === "Grup";
    const nama = line.nama || (paket ? "Paket" : "Barang persediaan");
    const lineNet = new PosDecimal(lineNets[index]);
    const effectiveNet = afterItems.gt(0) && Number.isFinite(netTotal) ? lineNet.times(netTotal).div(afterItems) : new PosDecimal(0);
    const hpp = lineCosts[index] ?? null;
    if (!effectiveNet.isFinite() || effectiveNet.lte(0)) findings.push({ index, nama, paket, kind: "zero", net: 0, hpp });
    else if (hpp == null || !Number.isFinite(hpp) || hpp < 0) findings.push({ index, nama, paket, kind: "unknown", net: effectiveNet.toNumber(), hpp: null });
    else if (effectiveNet.lt(hpp)) findings.push({ index, nama, paket, kind: "below", net: effectiveNet.toNumber(), hpp });
  }
  return findings;
}

/** Total-level discounts, voucher and points are allocated by each line's share after item discounts. */
export function cashierPriceFloorIssue(lines: CashierLine[], netTotal: number, fifoLineCosts: (number | null)[]): string | null {
  if (!Number.isFinite(netTotal) || netTotal < 0 || fifoLineCosts.length !== lines.length) return "Harga neto atau HPP aktif tidak dapat diverifikasi.";
  const finding = priceFloorFindings(lines, netTotal, fifoLineCosts)[0];
  if (!finding) return null;
  const { nama, paket, kind } = finding;
  if (kind === "zero") return paket
    ? `Harga neto paket ${nama} nol; paket berisi barang Persediaan ditolak.`
    : `Harga neto ${nama} nol; penjualan Persediaan ditolak.`;
  if (kind === "unknown") return `HPP aktif ${nama} belum dapat diverifikasi; penjualan ditolak.`;
  return paket
    ? `Harga neto paket ${nama} di bawah total HPP FIFO komponennya; penjualan ditolak.`
    : `Harga neto ${nama} di bawah batas aman HPP FIFO; penjualan ditolak.`;
}

/**
 * Pesan ramah untuk penolakan harga minimum dari database kasir petshop
 * (cashier_post_stock_atomic, P03). Pesan lain dikembalikan apa adanya.
 */
export function cashierPriceFloorDbMessage(message: string): string {
  const rules: [string, (name: string) => string][] = [
    ["Harga neto paket Grup di bawah total HPP FIFO komponen; penjualan ditolak:",
      name => `Harga neto paket ${name} di bawah total HPP FIFO komponennya. Naikkan harga atau kurangi diskon.`],
    ["Harga neto paket Grup nol; penjualan ditolak:",
      name => `Harga neto paket ${name} nol. Paket berisi barang tidak boleh gratis.`],
    ["Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak:",
      name => `Harga neto ${name} di bawah HPP FIFO. Naikkan harga atau kurangi diskon.`],
    ["Harga neto Persediaan nol; penjualan ditolak:",
      name => `Harga neto ${name} nol. Barang tidak boleh dijual gratis (jasa tetap boleh).`],
  ];
  for (const [prefix, text] of rules) {
    const at = message.indexOf(prefix);
    if (at < 0) continue;
    const name = message.slice(at + prefix.length).trim().split(/[\r\n]/)[0].slice(0, 120);
    return text(name || "barang");
  }
  return message;
}
