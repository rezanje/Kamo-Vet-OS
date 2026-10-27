"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CORRECTION_QUEUE_PATH, sourceHref, type CorrectionSourceKind } from "@/lib/purchase-correction-requests";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: CorrectionSourceKind[] = ["purchase_order", "purchase_invoice"];
const ANCHOR = "#request-purchase-correction";
const RETURN_PATHS = new Set(["/keuangan/hutang"]);

// SQLSTATEs raised by the request RPCs' own guards (Indonesian, user-facing text).
const GUARD_CODES = new Set(["42501", "22023", "23505", "55000"]);

function message(error: { message?: string; code?: string } | null, fallback: string) {
  const text = error?.message?.trim();
  // Only the RPC guards' own messages are shown; infrastructure errors stay generic.
  return text && GUARD_CODES.has(error?.code ?? "") && /^[A-Z][^\n]{3,200}$/.test(text)
    && !/violates|syntax|relation|function|permission denied/i.test(text) ? text : fallback;
}

/** Simpan permintaan koreksi. Tidak mengubah PO/faktur; hanya mengantre untuk Super Admin. */
export async function ajukanKoreksiPembelian(formData: FormData) {
  const kind = String(formData.get("source_kind") ?? "") as CorrectionSourceKind;
  const id = String(formData.get("source_id") ?? "");
  // P01: pengaju tanpa modul Pembelian (mis. FINANCE dari layar Hutang) kembali ke layar
  // asalnya, bukan ke halaman dokumen yang tidak bisa ia buka. Hanya jalur yang terdaftar.
  const from = String(formData.get("back") ?? "");
  const back = RETURN_PATHS.has(from) ? from
    : KINDS.includes(kind) && UUID.test(id) ? sourceHref({ source_kind: kind, po_id: id, invoice_id: id })! : "/pembelian";
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_purchase_correction_request", {
    p_source_kind: kind, p_source_id: UUID.test(id) ? id : null,
    p_request_key: String(formData.get("request_key") ?? ""), p_detail: String(formData.get("detail") ?? ""),
  });
  if (error) redirect(`${back}?koreksi_error=${encodeURIComponent(message(error, "Permintaan koreksi belum tersimpan. Coba lagi."))}${ANCHOR}`);
  revalidatePath(back);
  revalidatePath(CORRECTION_QUEUE_PATH);
  redirect(`${back}?koreksi=terkirim${ANCHOR}`);
}

/** Super Admin menandai request sudah diproses, dengan catatan tindak lanjut. Transaksi tidak disentuh. */
export async function prosesKoreksiPembelian(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("process_purchase_correction_request", {
    p_id: UUID.test(id) ? id : null, p_resolution: String(formData.get("resolution") ?? ""),
  });
  if (error) redirect(`${CORRECTION_QUEUE_PATH}?error=${encodeURIComponent(message(error, "Status permintaan belum tersimpan. Muat ulang lalu coba lagi."))}`);
  revalidatePath(CORRECTION_QUEUE_PATH);
  redirect(`${CORRECTION_QUEUE_PATH}?status=selesai&success=${encodeURIComponent("Permintaan ditandai sudah diproses.")}`);
}
