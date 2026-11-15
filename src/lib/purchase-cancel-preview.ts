import type { DocumentKind } from "@/lib/related-document-routes";

/** Pratinjau baca-saja pembatalan penerimaan barang (RPC preview_goods_receipt_cancellation). Menyebut PERSIS apa yang menghalangi
 * dan dokumen mana yang harus dibatalkan lebih dulu. Hanya tampilan: pembatalan sungguhan tetap diperiksa ulang oleh database. */
export type PreviewDoc = { kind: DocumentKind; id: string; label: string };
export type PreviewOutflow = { source: string; source_ref: string; tanggal: string; qty: number };
export type PreviewConsumedItem = { item_id: string; nama: string; qty_diterima: number; qty_masih_utuh: number; qty_terpakai: number };
export type CancelBlocker = {
  code: string; message: string; docs: PreviewDoc[]; paid?: number; items?: PreviewConsumedItem[]; keluar?: PreviewOutflow[];
};
export type ReceiptCancelPreview = {
  receipt_id: string; no_terima: string; po_id: string; no_po: string | null; tanggal: string;
  already_cancelled: boolean; can_cancel: boolean; blockers: CancelBlocker[]; average: boolean;
  effects: { total?: number; stock?: { item_id: string; nama: string; qty: number }[]; po_status_after?: string };
};

const KINDS = new Set(["purchase-order", "purchase-invoice", "purchase-return", "purchase-payment", "purchase-advance", "goods-receipt"]);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);

export function parseReceiptCancelPreview(value: unknown): ReceiptCancelPreview | null {
  if (!isObj(value) || typeof value.receipt_id !== "string" || typeof value.no_terima !== "string"
    || typeof value.can_cancel !== "boolean" || !Array.isArray(value.blockers)) return null;
  const blockers: CancelBlocker[] = [];
  for (const raw of value.blockers) {
    if (!isObj(raw) || typeof raw.code !== "string" || typeof raw.message !== "string" || !raw.message.trim()) return null;
    const docs: PreviewDoc[] = [];
    for (const d of Array.isArray(raw.docs) ? raw.docs : []) {
      if (isObj(d) && typeof d.id === "string" && typeof d.label === "string" && typeof d.kind === "string" && KINDS.has(d.kind)) docs.push({ kind: d.kind as DocumentKind, id: d.id, label: d.label });
    }
    const items = Array.isArray(raw.items) ? raw.items.filter(isObj).map(i => ({
      item_id: String(i.item_id ?? ""), nama: String(i.nama ?? ""), qty_diterima: num(i.qty_diterima), qty_masih_utuh: num(i.qty_masih_utuh), qty_terpakai: num(i.qty_terpakai),
    })) : undefined;
    const keluar = Array.isArray(raw.keluar) ? raw.keluar.filter(isObj).map(k => ({
      source: String(k.source ?? ""), source_ref: String(k.source_ref ?? ""), tanggal: String(k.tanggal ?? ""), qty: num(k.qty),
    })) : undefined;
    blockers.push({ code: raw.code, message: raw.message, docs, ...(raw.paid !== undefined ? { paid: num(raw.paid) } : {}), ...(items ? { items } : {}), ...(keluar ? { keluar } : {}) });
  }
  // Konsisten: bisa dibatalkan berarti tidak ada penghalang.
  if (value.can_cancel !== (blockers.length === 0)) return null;
  const e = isObj(value.effects) ? value.effects : {};
  return {
    receipt_id: value.receipt_id, no_terima: value.no_terima, po_id: String(value.po_id ?? ""), no_po: typeof value.no_po === "string" ? value.no_po : null,
    tanggal: String(value.tanggal ?? ""), already_cancelled: value.already_cancelled === true, can_cancel: value.can_cancel, blockers, average: value.average === true,
    effects: {
      ...(e.total !== undefined ? { total: num(e.total) } : {}),
      ...(Array.isArray(e.stock) ? { stock: e.stock.filter(isObj).map(s => ({ item_id: String(s.item_id ?? ""), nama: String(s.nama ?? ""), qty: num(s.qty) })) } : {}),
      ...(typeof e.po_status_after === "string" ? { po_status_after: e.po_status_after } : {}),
    },
  };
}

type PreviewClient = { rpc(name: "preview_goods_receipt_cancellation", args: { p_receipt_id: string }): PromiseLike<{ data: unknown; error: { message?: string } | null }> };

/** Tidak pernah melempar: galat baca = `preview: null` dengan pesan. Tombol batal Owner tidak bergantung pada pratinjau (database tetap memeriksa). */
export async function loadReceiptCancelPreview(client: PreviewClient, receiptId: string): Promise<{ preview: ReceiptCancelPreview | null; error: string | null }> {
  try {
    const { data, error } = await client.rpc("preview_goods_receipt_cancellation", { p_receipt_id: receiptId });
    if (error) return { preview: null, error: error.message ?? "Pratinjau belum dapat dimuat." };
    const preview = parseReceiptCancelPreview(data);
    return preview ? { preview, error: null } : { preview: null, error: "Pratinjau belum dapat dibaca. Muat ulang halaman." };
  } catch {
    return { preview: null, error: "Pratinjau belum dapat dimuat. Muat ulang halaman." };
  }
}
