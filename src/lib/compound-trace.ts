import type { SupabaseClient } from "@supabase/supabase-js";
import { hrefDokumen, hrefInvoiceKlinik, hrefPerintahProduksi, tampakNomorDokumen } from "@/lib/tautan-dokumen";

// I09: jejak racikan nonstok. Induknya tidak punya stok; yang dibaca adalah
// pengambilan bahan (FIFO), asal lapisan bahan, mutasi stok bahan, dan invoice
// tujuan. Semua lewat satu RPC baca-saja; tidak ada baris stok baru.

export type CompoundTraceMaterial = {
  item_id: string; item_name: string; unit: string; warehouse_name: string; qty: number;
  restored: boolean;
  origin: { source: string; ref: string | null; tanggal: string | null; production_order_id: string | null; no_produksi: string | null };
  invoice: { id: string; visit_id: string; invoice_no: string | null; voided: boolean } | null;
};
export type CompoundTraceMove = { tanggal: string; item_id: string; item_name: string; unit: string; warehouse_name: string; qty: number };
export type CompoundTrace = { recipe_id: string; visit_id: string; materials: CompoundTraceMaterial[]; moves: CompoundTraceMove[] };

const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optStr = (v: unknown) => v === null || v === undefined || str(v);
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function invalid(): never {
  throw new Error("Jejak racikan tidak valid.");
}

export function parseCompoundTrace(data: unknown, recipeId: string): CompoundTrace {
  if (!obj(data) || data.recipe_id !== recipeId || !str(data.visit_id) || !Array.isArray(data.materials) || !Array.isArray(data.moves)) invalid();
  const materials = data.materials.map((value): CompoundTraceMaterial => {
    if (!obj(value) || !str(value.item_id) || !str(value.item_name) || !str(value.unit) || !str(value.warehouse_name)
      || !num(value.qty) || typeof value.restored !== "boolean" || !obj(value.origin) || !str(value.origin.source)
      || !optStr(value.origin.ref) || !optStr(value.origin.tanggal) || !optStr(value.origin.production_order_id) || !optStr(value.origin.no_produksi)) invalid();
    const invoice = value.invoice;
    if (invoice !== null && invoice !== undefined && (!obj(invoice) || !str(invoice.id) || !str(invoice.visit_id)
      || !optStr(invoice.invoice_no) || typeof invoice.voided !== "boolean")) invalid();
    const o = value.origin;
    return {
      item_id: value.item_id, item_name: value.item_name, unit: value.unit, warehouse_name: value.warehouse_name,
      qty: value.qty, restored: value.restored,
      origin: {
        source: o.source as string, ref: (o.ref as string | null) ?? null, tanggal: (o.tanggal as string | null) ?? null,
        production_order_id: (o.production_order_id as string | null) ?? null, no_produksi: (o.no_produksi as string | null) ?? null,
      },
      invoice: obj(invoice) ? {
        id: invoice.id as string, visit_id: invoice.visit_id as string,
        invoice_no: (invoice.invoice_no as string | null) ?? null, voided: invoice.voided as boolean,
      } : null,
    };
  });
  const moves = data.moves.map((value): CompoundTraceMove => {
    if (!obj(value) || !str(value.tanggal) || !str(value.item_id) || !str(value.item_name) || !str(value.unit)
      || !str(value.warehouse_name) || !num(value.qty)) invalid();
    return { tanggal: value.tanggal, item_id: value.item_id, item_name: value.item_name, unit: value.unit, warehouse_name: value.warehouse_name, qty: value.qty };
  });
  return { recipe_id: recipeId, visit_id: data.visit_id, materials, moves };
}

export async function readCompoundTrace(client: SupabaseClient, recipeId: string): Promise<CompoundTrace> {
  const { data, error } = await client.rpc("read_compound_trace", { p_recipe_id: recipeId });
  if (error) throw new Error("Jejak racikan belum dapat diperiksa.");
  return parseCompoundTrace(data, recipeId);
}

const SOURCE_LABEL: Record<string, string> = {
  produksi: "Produksi", racik: "Pengembalian racikan", purchase: "Pembelian", "faktur-langsung": "Faktur pembelian",
  penerimaan: "Penerimaan barang", transfer: "Mutasi gudang", mutasi: "Mutasi gudang", opname: "Opname",
  "saldo-awal": "Saldo awal", retur: "Retur",
};
export const labelAsalBahan = (source: string) => SOURCE_LABEL[source] ?? source;

/** Tautan asal lapisan bahan: pekerjaan produksi, atau nomor dokumen yang dikenali. */
export function hrefAsalBahan(origin: CompoundTraceMaterial["origin"]): { label: string; href: string } | null {
  if (origin.source === "produksi" && origin.no_produksi) return { label: origin.no_produksi, href: hrefPerintahProduksi(origin.no_produksi) };
  if (origin.ref && tampakNomorDokumen(origin.ref)) return { label: origin.ref, href: hrefDokumen(origin.ref) };
  return null;
}

export function hrefInvoiceTujuan(invoice: NonNullable<CompoundTraceMaterial["invoice"]>): string {
  return hrefInvoiceKlinik(invoice.visit_id, invoice.id);
}
