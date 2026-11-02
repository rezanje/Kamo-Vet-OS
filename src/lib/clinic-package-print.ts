import Decimal from "decimal.js";
import type { ServicePerformersSnapshot } from "./service-performers";
import { nilaiBaris } from "./tagihan-klinik";

type Rel<T> = T | T[] | null;
export type PackagePrintSource = {
  invoice_id?: string;
  service_performers?: ServicePerformersSnapshot | null;
  salesperson_name?: string | null;
  deskripsi: string;
  qty: number;
  harga: number;
  diskon_persen?: number | null;
  package_item_id?: string | null;
  package_qty?: number | null;
  package?: Rel<{ name: string | null }>;
};
export type CustomerPrintLine = {
  deskripsi: string; qty: number; harga: number;
  diskon_persen: number | null; diskon: number; jumlah: number; sources: PackagePrintSource[];
};

/** Presentation only: persisted package origin determines grouping, never SKU names
 * or today's recipe. Internal invoice/stock/HPP rows remain untouched. A separately
 * sold material remains an ordinary visible sale; packages never merge across invoices.
 */
export function customerPackageLines(rows: readonly PackagePrintSource[], saved?: { subtotal: unknown }): CustomerPrintLine[] {
  const numeric = (value: unknown) => (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number.isFinite(Number(value));
  for (const row of rows) {
    if (!numeric(row.qty) || !numeric(row.harga)
      || (row.diskon_persen != null && !numeric(row.diskon_persen))
      || !Number.isFinite(Number(row.qty) * Number(row.harga))) {
      throw new Error("Nilai rincian invoice belum dapat diverifikasi. Muat ulang sebelum mencetak.");
    }
  }
  // Compare the original net source lines, before invoice-level discount/tax.
  // Saved money is numeric(15,2); do not compare rounded whole-rupiah display values.
  if (saved) {
    const subtotal = saved.subtotal;
    // Construct decimals from the persisted fields, not nilaiBaris' binary net.
    // Sum unrounded source nets, then match PostgreSQL numeric(15,2) once.
    const net = rows.reduce((sum, row) => {
      const percent = Decimal.min(100, Decimal.max(0, row.diskon_persen ?? 0));
      return sum.plus(new Decimal(row.qty).times(row.harga).times(new Decimal(100).minus(percent)).div(100));
    }, new Decimal(0));
    if (!numeric(subtotal) || !net.isFinite()
      || !net.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).equals(new Decimal(String(subtotal)))) {
      throw new Error("Subtotal rincian invoice belum dapat diverifikasi. Muat ulang sebelum mencetak.");
    }
  }
  const result: CustomerPrintLine[] = [];
  const groups = new Map<string, { line: CustomerPrintLine; gross: number; qty: number }>();
  for (const row of rows) {
    const gross = Number(row.qty) * Number(row.harga);
    const net = nilaiBaris(row);
    const percent = Math.min(100, Math.max(0, Number(row.diskon_persen) || 0));
    if (!row.package_item_id) {
      result.push({ deskripsi: row.deskripsi, qty: Number(row.qty), harga: Number(row.harga),
        diskon_persen: percent, diskon: gross - net, jumlah: net, sources: [row] });
      continue;
    }
    if (Array.isArray(row.package) && row.package.length !== 1) {
      throw new Error("Nama paket belum dapat diverifikasi. Muat ulang sebelum mencetak.");
    }
    const relation = Array.isArray(row.package) ? row.package[0] : row.package;
    const name = relation?.name?.trim();
    const qty = Number(row.package_qty);
    if (!name || !Number.isFinite(qty) || qty <= 0) {
      throw new Error("Nama atau jumlah paket belum dapat diverifikasi. Muat ulang sebelum mencetak.");
    }
    const key = `${row.invoice_id ?? ""}:${row.package_item_id}`;
    const group = groups.get(key);
    if (group) {
      if (group.qty !== qty || group.line.deskripsi !== name) {
        throw new Error("Rincian paket tidak konsisten. Muat ulang sebelum mencetak.");
      }
      group.line.sources.push(row);
      group.gross += gross;
      group.line.jumlah += net;
      group.line.harga = group.gross / qty;
      group.line.diskon = group.gross - group.line.jumlah;
      if (group.line.diskon_persen !== percent) group.line.diskon_persen = null;
    } else {
      const line: CustomerPrintLine = { deskripsi: name, qty, harga: gross / qty,
        diskon_persen: percent, diskon: gross - net, jumlah: net, sources: [row] };
      result.push(line);
      groups.set(key, { line, gross, qty });
    }
  }
  return result;
}
