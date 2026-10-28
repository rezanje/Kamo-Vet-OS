"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

export type BarisPreview = {
  nama: string; satuan: string | null;
  old_qty: number; new_qty: number; old_harga: number; new_harga: number;
  old_diskon: number; new_diskon: number; old_subtotal: number; new_subtotal: number;
};

export type FakturPreview = {
  invoice_id: string; no_faktur: string; tanggal: string; jatuh_tempo: string;
  old_gross: number; new_gross: number; old_diskon: number; new_diskon: number;
  old_dpp: number; new_dpp: number; old_ppn: number; new_ppn: number;
  old_total: number; new_total: number;
  ar_delta: number; revenue_delta: number; diskon_delta: number; ppn_delta: number;
  old_hpp: number; new_hpp: number; lines: BarisPreview[];
};

export type BarisKirim = { id: string; qty: number; harga: number; diskon: number };

/** Pratinjau dampak edit faktur: jalur yang sama persis dengan simpan, lalu dibatalkan di database. */
export async function pratinjauFakturJual(input: {
  invoiceId: string; tanggal: string; jatuhTempo: string; catatan: string; items: BarisKirim[];
}): Promise<{ ok: true; preview: FakturPreview } | { ok: false; error: string }> {
  const db = await createClient();
  const { data, error } = await db.rpc("preview_wholesale_invoice_lines", {
    p_invoice_id: input.invoiceId, p_tanggal: input.tanggal, p_jatuh_tempo: input.jatuhTempo,
    p_catatan: input.catatan, p_items: input.items,
  });
  if (error || !data) return { ok: false, error: error?.message ?? "Pratinjau belum tersedia. Coba lagi." };
  return { ok: true, preview: data as FakturPreview };
}

/** Simpan edit faktur. Hasil dikembalikan ke pop-up supaya pesan gagal tampil di dalam pop-up. */
export async function simpanFakturJual(formData: FormData): Promise<{ ok: true; replacementId: string } | { ok: false; error: string }> {
  const invoiceId = String(formData.get("invoice_id") ?? "");
  let expected: unknown = null;
  let items: unknown = null;
  try { expected = JSON.parse(String(formData.get("expected") ?? "null")); } catch { /* RPC menolak tanpa pratinjau. */ }
  try { items = JSON.parse(String(formData.get("items") ?? "null")); } catch { /* RPC menolak rincian yang tidak lengkap. */ }
  const db = await createClient();
  const { data, error } = await db.rpc("correct_wholesale_invoice_lines", {
    p_request_key: String(formData.get("request_key") ?? ""), p_invoice_id: invoiceId,
    p_expected_revision: Number(formData.get("revision")), p_tanggal: String(formData.get("tanggal") ?? ""),
    p_jatuh_tempo: String(formData.get("jatuh_tempo") ?? ""), p_catatan: String(formData.get("catatan") ?? ""),
    p_items: items, p_reason: String(formData.get("alasan") ?? "").trim(), p_expected: expected,
  });
  if (error || data?.invoice_id !== invoiceId || !data?.replacement_id) {
    return { ok: false, error: error?.message ?? "Perubahan belum terkonfirmasi. Muat ulang faktur sebelum mengulang." };
  }
  for (const path of ["/penjualan/faktur", `/penjualan/faktur/${invoiceId}`, `/penjualan/faktur/${data.replacement_id}`,
    "/penjualan/pesanan", "/keuangan/piutang", "/keuangan/piutang/pembantu", "/laporan/penjual", "/penjualan/komisi",
    "/laporan/operasional-penjualan", "/"]) revalidatePath(path);
  revalidatePath("/penjualan/pesanan/[id]", "page");
  return { ok: true, replacementId: String(data.replacement_id) };
}

/** Hapus (balik) satu Penerimaan Penjualan. Jurnal dibalik, uang muka dikembalikan. */
export async function hapusPenerimaanJual(formData: FormData) {
  const db = await createClient();
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const receiptId = String(formData.get("receipt_id") ?? "");
  const back = `/penjualan/faktur/${encodeURIComponent(invoiceId)}`;
  const key = String(formData.get("draft_key") ?? "");
  const pemeriksaan = formData.get("tindakan") === "periksa";
  const { data, error } = pemeriksaan
    ? await db.rpc("get_wholesale_operation", { p_invoice_id: invoiceId, p_kind: "receipt-cancel", p_request_key: key })
    : await db.rpc("cancel_wholesale_receipt", {
      p_receipt_id: receiptId, p_expected_revision: Number(formData.get("revision")),
      p_request_key: key, p_reason: String(formData.get("alasan") ?? "").trim(),
    });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  if (pemeriksaan && !data) {
    redirect(`${back}?error=${encodeURIComponent("Belum ada penghapusan terkonfirmasi untuk formulir ini. Periksa rincian sebelum mengirim ulang.")}`);
  }
  if (!data?.cancellation_id || !data?.reversal_journal_id || data.receipt_id !== receiptId || data.invoice_id !== invoiceId) {
    throw new Error("Penghapusan penerimaan belum terkonfirmasi lengkap. Periksa riwayat penerimaan sebelum mengulang.");
  }
  for (const path of [back, "/penjualan/faktur", "/keuangan/piutang", "/keuangan/piutang/pembantu",
    "/penjualan/uang-muka", "/laporan/penjual", "/"]) revalidatePath(path);
  redirect(`${back}?success=${encodeURIComponent("Penerimaan dihapus. Jurnalnya dibalik dan uang muka yang terpakai dikembalikan.")}${transactionDraftAck(formData)}`);
}
