/**
 * P03 "jual di bawah HPP": the database (clinic_private.assert_invoice_price_floor, 20261106860000) lists EVERY
 * offending row, one line each, e.g.
 *   - Infus Refill: harga neto Rp20.000 per pcs, HPP Rp29.578 per pcs, harga minimum Rp29.578 per pcs
 *   - Obat Racik Probiotik (racikan): harga neto ... per racikan, HPP ... per racikan, harga minimum ... per racikan
 *   - Paket Steril (paket): harga neto Rp800 untuk seluruh paket, total HPP komponen Rp1.000, harga minimum paket Rp1.000
 * The cashier screens read those lines (from the already-translated "Penjualan ditolak. ..." text too) to mark the
 * rows and show the minimum price. Pure functions: no I/O, nothing here decides what is allowed (the database does).
 */
export type PriceFloorRow = {
  kind: "row" | "racikan" | "paket";
  name: string;
  net: number | null;
  hpp: number | null;
  /** Minimum price to type in the Harga column (per unit; for a package the whole package). null = not computable. */
  minimum: number | null;
  unit: string | null;
};

const RP = "Rp[\\d.]+";
const ROW = new RegExp(`^[-•]\\s+(.+?)( \\(racikan\\))?: harga neto (${RP}) per ([^,]+), (?:HPP (${RP}) per [^,]+|HPP belum tersedia), (?:harga minimum (${RP}) per [^,]+|harga minimum tidak dapat dihitung.*)$`);
const PAKET = new RegExp(`^[-•]\\s+(.+) \\(paket\\): harga neto (${RP}) untuk seluruh paket, total HPP komponen (${RP}), (?:harga minimum paket (${RP})|harga minimum tidak dapat dihitung.*)$`);

const angka = (text: string | undefined): number | null => (text ? Number(text.replace(/^Rp/, "").replace(/\./g, "")) : null);
/** The database collapses whitespace in names; do the same before comparing. */
export const namaBaris = (text: string) => text.replace(/\s+/g, " ").trim();

export function parsePriceFloorRows(message: string | null | undefined): PriceFloorRow[] {
  if (!message) return [];
  const out: PriceFloorRow[] = [];
  for (const raw of message.split(/\r?\n/)) {
    const line = raw.trim();
    const paket = PAKET.exec(line);
    if (paket) { out.push({ kind: "paket", name: paket[1], net: angka(paket[2]), hpp: angka(paket[3]), minimum: angka(paket[4]), unit: null }); continue; }
    const row = ROW.exec(line);
    if (row) out.push({ kind: row[2] ? "racikan" : "row", name: row[1], net: angka(row[3]), hpp: angka(row[5]), minimum: angka(row[6]), unit: row[4].trim() });
  }
  return out;
}

/**
 * For one cashier row: the minimum price when the error names it AND its current price is still below that minimum;
 * 0 when it is named but no minimum is computable; null when the row is not (or no longer) offending.
 * A racikan row only matches racikan lines, a plain row only plain lines.
 */
export function hargaMinimumUntuk(rows: PriceFloorRow[], line: { deskripsi: string; harga: number; recipe_id?: string | null }): number | null {
  const wanted = line.recipe_id ? "racikan" : "row";
  const hit = rows.find(row => row.kind === wanted && row.name === namaBaris(line.deskripsi));
  if (!hit) return null;
  if (hit.minimum === null) return 0;
  return Number(line.harga) < hit.minimum ? hit.minimum : null;
}

/** Package named in the error: its minimum total price (0 when not computable), else null. */
export function paketDiBawahHpp(rows: PriceFloorRow[], name: string): number | null {
  const hit = rows.find(row => row.kind === "paket" && row.name === namaBaris(name));
  return hit ? hit.minimum ?? 0 : null;
}
