// Penolong server untuk rantai dokumen penjualan (migrasi 0098).
// Dipisah dari server action supaya penomoran & pembacaan baris tidak ditulis ulang
// di enam layar berbeda.

import { type PrefixDokumen } from "./penjualan-dokumen";
import { nomorBerikutnya } from "./no-dokumen";
import { hariIniWIB } from "./tanggal";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

const TABEL: Record<PrefixDokumen, string> = {
  SQ: "sales_quotations",
  SO: "sales_orders",
  DO: "sales_deliveries",
  FJ: "sales_invoices",
  FJK: "sales_invoices",
  FJS: "sales_invoices",
  RC: "sales_receipts",
  UJ: "sales_advances",
};

const KOLOM: Record<PrefixDokumen, string> = {
  SQ: "no_penawaran",
  SO: "no_pesanan",
  DO: "no_kirim",
  FJ: "no_faktur",
  FJK: "no_faktur",
  FJS: "no_faktur",
  RC: "no_terima",
  UJ: "no_um",
};

/** Nomor dokumen berikutnya; formatnya dibaca dari master penomoran. */
export async function nextNoDokumen(supabase: AnyClient, prefix: PrefixDokumen): Promise<string> {
  const { nomor } = await nomorBerikutnya(supabase, prefix, hariIniWIB(), {
    table: TABEL[prefix], column: KOLOM[prefix],
  });
  return nomor;
}

export type BarisInput = {
  nama: string; qty: number; harga: number;
  item_id?: string | null; satuan?: string | null;
  /** Isi per satuan pilihan (1 dus = 12 pcs → 12). Stok dipotong qty × faktor. */
  faktor?: number;
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
    const faktor = Number(row.faktor);
    return [{
      nama: nama.slice(0, 160),
      qty,
      harga: Math.max(0, harga),
      item_id: row.item_id ?? null,
      satuan: row.satuan ?? null,
      faktor: Number.isFinite(faktor) && faktor > 0 ? faktor : 1,
    }];
  });
}

export const totalBaris = (baris: BarisInput[]): number =>
  baris.reduce((a, b) => a + b.qty * b.harga, 0);
