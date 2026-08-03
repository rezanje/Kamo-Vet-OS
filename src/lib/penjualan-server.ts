// Penolong server untuk rantai dokumen penjualan (migrasi 0098).
// Dipisah dari server action supaya penomoran & pembacaan baris tidak ditulis ulang
// di enam layar berbeda.

import { formatNoDokumen, type PrefixDokumen } from "./penjualan-dokumen";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

const TABEL: Record<PrefixDokumen, string> = {
  SQ: "sales_quotations",
  SO: "sales_orders",
  DO: "sales_deliveries",
  FJ: "sales_invoices",
  RC: "sales_receipts",
  UJ: "sales_advances",
};

/** Nomor dokumen berikutnya, urut per bulan. */
export async function nextNoDokumen(supabase: AnyClient, prefix: PrefixDokumen): Promise<string> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { count } = await supabase
    .from(TABEL[prefix]).select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString());
  return formatNoDokumen(prefix, now, (count ?? 0) + 1);
}

export type BarisInput = {
  nama: string; qty: number; harga: number;
  item_id?: string | null; satuan?: string | null;
};

/**
 * Baca baris dokumen dari form. Baris tanpa nama atau tanpa qty dibuang di sini,
 * bukan disimpan sebagai baris kosong yang bikin total tidak cocok.
 */
export function bacaBaris(raw: FormDataEntryValue | null): BarisInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? "[]"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((r) => {
    const row = r as Partial<BarisInput>;
    const nama = String(row.nama ?? "").trim();
    const qty = Number(row.qty) || 0;
    const harga = Number(row.harga) || 0;
    if (!nama || qty <= 0) return [];
    return [{
      nama: nama.slice(0, 160),
      qty,
      harga: Math.max(0, harga),
      item_id: row.item_id ?? null,
      satuan: row.satuan ?? null,
    }];
  });
}

export const totalBaris = (baris: BarisInput[]): number =>
  baris.reduce((a, b) => a + b.qty * b.harga, 0);
