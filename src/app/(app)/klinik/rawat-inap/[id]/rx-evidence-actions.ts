"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN = /^(RX_EVIDENCE_INVALID|RX_EVIDENCE_LOCKED|ACCESS_DENIED|IDEMPOTENCY_CONFLICT): (.{1,200})$/;

/** Only messages raised by our own RPC guards are shown; anything else stays generic. */
function rxEvidenceError(error: { message?: string } | null): string {
  const match = KNOWN.exec(error?.message ?? "");
  return match ? match[2] : "Bukti obat belum tersimpan. Muat ulang halaman lalu periksa data.";
}

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const backTo = (recordId: string) => `/klinik/rawat-inap/${UUID.test(recordId) ? recordId : ""}`;
const fail = (recordId: string, message: string): never =>
  redirect(`${backTo(recordId)}?error=${encodeURIComponent(message)}#bukti-obat-biasa`);

/** WIB wall-clock from <input type="datetime-local">; empty means "now" on the server. */
function occurredAt(value: string): string | null | undefined {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const at = new Date(`${value}:00+07:00`);
  if (Number.isNaN(at.getTime())) return undefined;
  // Date silently normalizes impossible wall times (for example 31 February).
  const roundTrip = new Date(at.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
  return roundTrip === value ? at.toISOString() : undefined;
}

/**
 * Record one handover or administration of a regular drug against its exact prescription line.
 * The RPC validates branch, visit, quantity, idempotency and the branch evidence settings.
 */
export async function catatBuktiObatBiasa(formData: FormData) {
  const recordId = field(formData, "recordId");
  const prescriptionId = field(formData, "prescriptionItemId");
  const kind = field(formData, "kind");
  const requestKey = field(formData, "requestKey");
  const qtyText = field(formData, "qty").replace(",", ".");
  const note = field(formData, "note");
  const at = occurredAt(field(formData, "occurredAt"));
  if (!UUID.test(recordId) || !UUID.test(prescriptionId) || !requestKey || requestKey.length < 8 || requestKey.length > 100)
    fail(recordId, "Formulir bukti obat tidak lengkap. Muat ulang halaman.");
  if (kind !== "handover" && kind !== "administration") fail(recordId, "Pilih penyerahan atau pemberian.");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(qtyText) || Number(qtyText) <= 0)
    fail(recordId, "Jumlah harus lebih dari nol dengan maksimal tiga desimal.");
  if (note.length > 1000) fail(recordId, "Catatan maksimal 1000 karakter.");
  if (at === undefined) fail(recordId, "Waktu bukti tidak valid.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("clinic_record_rx_evidence", {
    p_inpatient_record_id: recordId,
    p_prescription_item_id: prescriptionId,
    p_kind: kind,
    p_qty: qtyText,
    p_occurred_at: at,
    p_note: note || null,
    p_request_key: requestKey,
  });
  if (error) fail(recordId, rxEvidenceError(error));
  revalidatePath(backTo(recordId));
  redirect(`${backTo(recordId)}?success=rxbukti#bukti-obat-biasa`);
}

/** Void one evidence row with a reason. The row stays visible with who/when/why. */
export async function batalkanBuktiObatBiasa(formData: FormData) {
  const recordId = field(formData, "recordId");
  const evidenceId = field(formData, "evidenceId");
  const reason = field(formData, "reason");
  if (!UUID.test(recordId) || !UUID.test(evidenceId)) fail(recordId, "Bukti obat tidak valid. Muat ulang halaman.");
  if (reason.length < 3 || reason.length > 500) fail(recordId, "Isi alasan pembatalan (3 sampai 500 karakter).");
  const supabase = await createClient();
  const { error } = await supabase.rpc("clinic_void_rx_evidence", { p_evidence_id: evidenceId, p_reason: reason });
  if (error) fail(recordId, rxEvidenceError(error));
  revalidatePath(backTo(recordId));
  redirect(`${backTo(recordId)}?success=rxbuktibatal#bukti-obat-biasa`);
}
