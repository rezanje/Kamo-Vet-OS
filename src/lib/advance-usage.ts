import type { SupabaseClient } from "@supabase/supabase-js";
import { readCompleteList } from "@/lib/checked-list";
import { relatedDocumentHref } from "@/lib/related-document-routes";

// Where a DP was applied, read only through the stored `advance_id` on each payment/receipt.
// A document the user cannot read keeps no number and no link; nothing is matched by name or amount.
export type AdvanceUsage = { id: string; tanggal: string; label: string; href: string | null; note: string };
type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const HIDDEN = "Dokumen pemakaian tidak tersedia untuk akses Anda";

async function byAdvance<T extends { id: string; advance_id: string; tanggal: string }>(
  client: SupabaseClient, table: string, columns: string, advanceIds: string[], label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < advanceIds.length; i += 100) {
    const ids = advanceIds.slice(i, i + 100);
    rows.push(...await readCompleteList<T>((from, to) => client.from(table).select(columns, { count: "exact" })
      .in("advance_id", ids).order("tanggal").order("id").range(from, to) as never, label, { maxRows: null }));
  }
  return rows;
}

function group(usages: (AdvanceUsage & { advanceId: string })[]) {
  const map = new Map<string, AdvanceUsage[]>();
  for (const { advanceId, ...usage } of usages) map.set(advanceId, [...(map.get(advanceId) ?? []), usage]);
  for (const list of map.values()) list.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.id.localeCompare(b.id));
  return map;
}

type PurchasePayment = { id: string; invoice_id: string; advance_id: string; tanggal: string; dari_uang_muka: number;
  reversal_of: string | null; voided_at: string | null; purchase_invoices: Rel<{ id: string; no_faktur: string }> };
type LegacyPayment = { id: string; po_id: string; advance_id: string; tanggal: string; amount: number;
  purchase_orders: Rel<{ id: string; no_po: string }> };

export async function loadPurchaseAdvanceUsage(client: SupabaseClient, advanceIds: string[]) {
  const [payments, legacy] = await Promise.all([
    byAdvance<PurchasePayment>(client, "purchase_invoice_payments",
      "id,invoice_id,advance_id,tanggal,dari_uang_muka,reversal_of,voided_at,purchase_invoices(id,no_faktur)", advanceIds, "Pemakaian uang muka di faktur"),
    byAdvance<LegacyPayment>(client, "po_payments",
      "id,po_id,advance_id,tanggal,amount,purchase_orders(id,no_po)", advanceIds, "Pemakaian uang muka di PO"),
  ]);
  return group([
    ...payments.map(p => {
      const invoice = one(p.purchase_invoices);
      const readable = invoice?.id === p.invoice_id;
      return { advanceId: p.advance_id, id: p.id, tanggal: p.tanggal,
        label: readable ? `Faktur ${invoice.no_faktur}` : HIDDEN,
        href: readable ? relatedDocumentHref("purchase-payment", p.id, p.invoice_id) : null,
        note: p.reversal_of ? "pembatalan pemakaian" : p.voided_at ? "dibatalkan" : `dari DP ${rp(Number(p.dari_uang_muka))}` };
    }),
    ...legacy.map(p => {
      const order = one(p.purchase_orders);
      const readable = order?.id === p.po_id;
      return { advanceId: p.advance_id, id: p.id, tanggal: p.tanggal,
        label: readable ? `Pembayaran PO ${order.no_po}` : HIDDEN,
        href: readable ? relatedDocumentHref("legacy-purchase-payment", p.id, p.po_id) : null,
        note: `pembayaran lama ${rp(Number(p.amount))}` };
    }),
  ]);
}

type SalesReceipt = { id: string; no_terima: string; invoice_id: string; advance_id: string; tanggal: string;
  dari_uang_muka: number; sales_invoices: Rel<{ id: string; no_faktur: string }> };

export async function loadSalesAdvanceUsage(client: SupabaseClient, advanceIds: string[]) {
  const receipts = await byAdvance<SalesReceipt>(client, "sales_receipts",
    "id,no_terima,invoice_id,advance_id,tanggal,dari_uang_muka,sales_invoices(id,no_faktur)", advanceIds, "Pemakaian uang muka penjualan");
  return group(receipts.map(r => {
    const invoice = one(r.sales_invoices);
    const readable = invoice?.id === r.invoice_id;
    return { advanceId: r.advance_id, id: r.id, tanggal: r.tanggal,
      label: readable ? `${r.no_terima} · Faktur ${invoice.no_faktur}` : HIDDEN,
      href: readable ? relatedDocumentHref("sales-receipt", r.id, r.invoice_id) : null,
      note: `dari DP ${rp(Number(r.dari_uang_muka))}` };
  }));
}
