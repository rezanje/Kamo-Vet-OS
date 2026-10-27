"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

const IMPACT_KEYS = ["remaining_qty", "sold_qty", "removed_qty", "ap_delta", "ppn_delta", "inventory_delta", "hpp_delta"] as const;

/** P02: simpan koreksi harga/qty baris faktur. Server menolak bila dampak berbeda dari pratinjau. */
export async function koreksiHargaFaktur(formData: FormData) {
  const supabase = await createClient();
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const lineId = String(formData.get("line_id") ?? "");
  const qty = String(formData.get("qty") ?? "");
  const harga = String(formData.get("harga") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "");
  const back = `/pembelian/faktur/${encodeURIComponent(invoiceId)}`;
  const previewUrl = `${back}/koreksi?baris=${encodeURIComponent(lineId)}&qty=${encodeURIComponent(qty)}&harga=${encodeURIComponent(harga)}&tanggal=${encodeURIComponent(tanggal)}`;
  let expected: Record<string, number>;
  try {
    const raw = JSON.parse(String(formData.get("expected") ?? "null"));
    expected = Object.fromEntries(IMPACT_KEYS.map(key => {
      const value = Number(raw?.[key]);
      if (!Number.isFinite(value)) throw new Error("missing");
      return [key, value];
    }));
  } catch {
    redirect(`${previewUrl}&error=${encodeURIComponent("Pratinjau dampak tidak lengkap. Buka pratinjau ulang.")}`);
  }
  const { data, error } = await supabase.rpc("correct_purchase_invoice_line", {
    p_request_key: String(formData.get("draft_key") ?? ""), p_line_id: lineId,
    p_expected_revision: Number(formData.get("revision")), p_qty: Number(qty), p_harga: Number(harga),
    p_tanggal: tanggal, p_reason: String(formData.get("alasan") ?? "").trim(), p_expected: expected,
  });
  if (error) redirect(`${previewUrl}&error=${encodeURIComponent(error.message)}`);
  if (!data?.correction_id || data.invoice_id !== invoiceId || data.line_id !== lineId) {
    throw new Error("Koreksi belum terkonfirmasi lengkap. Periksa riwayat koreksi faktur sebelum mengulang.");
  }
  for (const path of [back, "/pembelian/faktur", "/keuangan/hutang", "/laporan/pembelian", "/pembelian/perintah-bayar", "/"]) revalidatePath(path);
  redirect(`${back}?success=${encodeURIComponent(`Koreksi harga tersimpan${data.no_jurnal ? ` (jurnal ${data.no_jurnal})` : ""}. Nilai stok, HPP, dan hutang sudah disesuaikan.`)}${transactionDraftAck(formData)}`);
}
