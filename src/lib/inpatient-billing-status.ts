// Read-only status for the already-authorized inpatient list, not a posting policy.
import type { createClient } from "./supabase/server";
import { ringkasTahap, type TagihanTahap, type BarisBayar } from "./tagihan-berjalan";

type Db = Awaited<ReturnType<typeof createClient>>;
export type BillingStatus = { label: string; badge: string; action: string };
export const BILLING_UNREAD: BillingStatus = { label: "Belum terbaca", badge: "o", action: "Buka tagihan" };
type Stay = { visit_id: string; branch_id: string };
type Invoice = TagihanTahap & { visit_id: string };
type Medical = { id: string; visit_id: string };
type Prescription = { id: string; medical_record_id: string };
type Table = "invoices" | "medical_records" | "invoice_items" | "invoice_payments" | "prescription_items";
const PAGE_SIZE = 500;

// Stable unique ordering and explicit sub-limit pages: never silently truncate money/Rx.
async function readRows<T>(db: Db, table: Table, fields: string, column: string, ids: string[]): Promise<T[]> {
  const rows: T[] = [];
  if (!ids.length) return rows;
  for (let chunk = 0; chunk < ids.length; chunk += 50) {
    const scope = ids.slice(chunk, chunk + 50);
    for (let start = 0; ; start += PAGE_SIZE) {
      const { data, error } = await db.from(table).select(fields).in(column, scope)
        .order("id").range(start, start + PAGE_SIZE - 1);
      if (error || !data) throw new Error("Incomplete inpatient billing read");
      rows.push(...data as unknown as T[]);
      if (data.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

export async function readInpatientBillingStatuses(db: Db, stays: readonly Stay[]): Promise<Map<string, BillingStatus>> {
  const visitIds = [...new Set(stays.map(r => r.visit_id).filter(Boolean))];
  const out = new Map<string, BillingStatus>();
  if (!visitIds.length) return out;
  try {
    const [invoices, records] = await Promise.all([
      readRows<Invoice>(db, "invoices", "id, visit_id, created_at, total, dp_amount, paid_status, voided_at, correction_pending, reissued_from", "visit_id", visitIds),
      readRows<Medical>(db, "medical_records", "id, visit_id", "visit_id", visitIds),
    ]);
    const invoiceIds = invoices.filter(i => !i.voided_at).map(i => i.id);
    const [payments, lines, prescriptions] = await Promise.all([
      readRows<BarisBayar>(db, "invoice_payments", "invoice_id, amount", "invoice_id", invoiceIds),
      readRows<{ prescription_item_id: string | null }>(db, "invoice_items", "prescription_item_id", "invoice_id", invoiceIds),
      readRows<Prescription>(db, "prescription_items", "id, medical_record_id", "medical_record_id", records.map(r => r.id)),
    ]);
    // Only active invoice links close a prescription (ordinary initial DP included).
    const billed = new Set(lines.map(r => r.prescription_item_id));
    const recordVisits = new Map(records.map(r => [r.id, r.visit_id]));
    const pendingVisits = new Set(prescriptions.filter(r => !billed.has(r.id)).map(r => recordVisits.get(r.medical_record_id)));
    for (const visitId of visitIds) {
      const stages = ringkasTahap(invoices.filter(i => i.visit_id === visitId), payments);
      const positive = stages.filter(i => Number(i.total) > 0);
      const paid = positive.length > 0 && positive.every(i => i.sisa === 0) && !stages.some(i => i.correction_pending);
      const partial = stages.some(i => i.sisa > 0 && i.dibayar > 0);
      out.set(visitId, stages.some(i => i.correction_pending) ? { label: "Koreksi tagihan", badge: "o", action: "Buka tagihan" }
        : pendingVisits.has(visitId) ? { label: "Belum ditagih", badge: "o", action: "Buka tagihan" }
        : paid ? { label: "Lunas", badge: "g", action: "Lihat tagihan" }
        : !stages.some(i => Number(i.total) > 0) ? { label: "Belum ada tagihan", badge: "o", action: "Buka tagihan" }
        : { label: partial ? "DP" : "Belum lunas", badge: "o", action: "Bayar tagihan" });
    }
    return out;
  } catch {
    // A failed/missing/denied source is unknown, never zero money or Lunas.
    return new Map();
  }
}
