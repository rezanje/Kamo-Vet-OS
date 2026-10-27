// A02/P01: permintaan koreksi pembelian yang tersimpan dan terikat dokumen asal.
// Request hanya catatan pekerjaan untuk Super Admin; koreksi resmi tetap memakai
// kontrol koreksi PO/faktur yang sudah ada dan tidak pernah dijalankan dari sini.
import { readCompleteList } from "@/lib/checked-list";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type CorrectionSourceKind = "purchase_order" | "purchase_invoice";
export type CorrectionStatus = "pending" | "selesai";
export type PurchaseCorrectionRequest = {
  id: string; source_kind: CorrectionSourceKind; po_id: string | null; invoice_id: string | null;
  source_label: string; detail: string; requested_by: string; status: CorrectionStatus;
  processed_by: string | null; processed_at: string | null; resolution: string | null; created_at: string;
};

export const CORRECTION_REQUEST_SELECT =
  "id,source_kind,po_id,invoice_id,source_label,detail,requested_by,status,processed_by,processed_at,resolution,created_at";
export const CORRECTION_QUEUE_PATH = "/pembelian/koreksi";
export const STATUS_LABEL: Record<CorrectionStatus, string> = { pending: "Menunggu Super Admin", selesai: "Sudah diproses" };

export function statusLabel(status: string) {
  return STATUS_LABEL[status as CorrectionStatus] ?? "Status tidak dikenal";
}

/** Link back to the exact origin document; null when the stored origin is incomplete. */
export function sourceHref(row: Pick<PurchaseCorrectionRequest, "source_kind" | "po_id" | "invoice_id">) {
  if (row.source_kind === "purchase_order" && row.po_id) return `/pembelian/${row.po_id}`;
  if (row.source_kind === "purchase_invoice" && row.invoice_id) return `/pembelian/faktur/${row.invoice_id}`;
  return null;
}

export const sourceKindLabel = (kind: string) => kind === "purchase_invoice" ? "Faktur" : "PO";

/** Every request on one origin document visible to this user (RLS: own, or all for Super Admin). */
export function loadRequestsForSource(db: AnyClient, kind: CorrectionSourceKind, id: string) {
  const column = kind === "purchase_order" ? "po_id" : "invoice_id";
  return readCompleteList<PurchaseCorrectionRequest>((from, to) => db.from("purchase_correction_requests")
    .select(CORRECTION_REQUEST_SELECT, { count: "exact" }).eq("source_kind", kind).eq(column, id)
    .order("created_at", { ascending: false }).order("id").range(from, to), "Permintaan koreksi dokumen ini", { maxRows: 1000 });
}
