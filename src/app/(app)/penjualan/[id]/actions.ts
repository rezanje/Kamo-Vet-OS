"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";
import { bacaTanggalEfektif, perluAlasanTanggal } from "@/lib/tanggal-efektif-petshop";
import type { ActionRejection } from "@/components/LocalTransactionDraft";

function correctionMoney(value: FormDataEntryValue | null): number {
  // A blank Tunai/Transfer box means nothing was paid that way.
  // A missing field is still rejected; the RPC re-checks that the split equals the bill.
  const text = typeof value === "string" ? value.trim() || "0" : "";
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(text)) throw new Error("Jumlah koreksi tidak valid. Isi angka Rupiah dengan maksimal dua desimal.");
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount > 1_000_000_000_000 || !Number.isSafeInteger(Math.round(amount * 100))) {
    throw new Error("Jumlah koreksi tidak valid. Muat ulang lalu coba lagi.");
  }
  return amount;
}

/**
 * Galat database ber-SQLSTATE berarti transaksi RPC sudah dibatalkan utuh (tidak ada yang tersimpan), jadi alasannya aman
 * ditampilkan apa adanya. Melempar galat justru disembunyikan Next.js di produksi dan tampil sebagai "respons belum terkonfirmasi".
 * Galat tanpa SQLSTATE (jaringan putus, dsb.) tetap dilempar: hasilnya belum pasti.
 */
function rpcRefusal(error: { code?: string; message?: string } | null): ActionRejection | null {
  const code = error?.code ?? "";
  if (!/^[0-9A-Z]{5}$/.test(code) || !error?.message) return null;
  const retry = code.startsWith("40") || code === "55P03" || code === "57014";
  return { ok: false, outcome: retry ? "retry" : "rejected", message: retry ? `${error.message}. Coba simpan lagi sebentar lagi.` : error.message };
}

export async function koreksiMetodePembayaran(form: FormData): Promise<void | ActionRejection> {
  const id = String(form.get("id") ?? "");
  const revisionText = String(form.get("revision") ?? "");
  const revision = Number(revisionText);
  const key = String(form.get("requestKey") ?? "");
  const reason = String(form.get("alasan") ?? "").trim();
  const cash = correctionMoney(form.get("tunai"));
  const transfer = correctionMoney(form.get("transfer"));
  if (!/^[0-9a-f-]{36}$/i.test(id) || !revisionText.trim() || !Number.isSafeInteger(revision) || revision < 0
    || !key.trim() || key.length > 120 || reason.length < 3 || reason.length > 1000) {
    throw new Error("Identitas atau alasan koreksi tidak valid. Muat ulang lalu coba lagi.");
  }
  const db = await createClient();
  const { data, error } = await db.rpc("correct_pos_sale_payment", {
    p_sale_id: id, p_expected_revision: revision, p_request_key: key, p_reason: reason,
    p_cash_amount: cash, p_transfer_amount: transfer,
  });
  const refusal = rpcRefusal(error);
  if (refusal) return refusal;
  if (error || data?.sale_id !== id || data?.revision !== revision + 1 || !data?.audit_id) {
    throw new Error(error?.message ?? "Hasil koreksi belum terkonfirmasi. Coba lagi dengan formulir yang sama.");
  }
  revalidatePath("/", "layout");
  redirect(`/penjualan/${id}?success=payment-corrected&draft_scope=${encodeURIComponent(`sale-payment:${id}:${revision}`)}&draft_done=${encodeURIComponent(key)}`);
}

export async function batalkanPenjualan(form: FormData) {
  const id = String(form.get("id") ?? "");
  const revisionText = String(form.get("revision") ?? "");
  const revision = Number(revisionText);
  const key = String(form.get("requestKey") ?? "");
  const reason = String(form.get("alasan") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !revisionText.trim() || !Number.isSafeInteger(revision) || revision < 0 || !key || reason.length < 3 || reason.length > 1000) {
    throw new Error("Identitas atau alasan pembatalan tidak lengkap. Muat ulang lalu coba lagi.");
  }
  const db = await createClient();
  const { data, error } = await db.rpc("cancel_posted_sale", {
    p_sale_id: id, p_expected_revision: revision, p_request_key: key, p_reason: reason,
  });
  if (error || !data?.voided) throw new Error(error?.message ?? "Hasil pembatalan belum terkonfirmasi. Coba ulang dengan formulir yang sama.");
  revalidatePath("/", "layout");
  // A replacement is a fresh checkout with its own reviewed price/payment.
  if (form.get("tindakan") === "ganti") {
    const { data: sale, error: readError } = await db.from("sales").select("channel").eq("id", id).single();
    if (readError || !sale) throw new Error("Pembatalan tersimpan. Buka kembali riwayat penjualan untuk membuat pengganti.");
    redirect(`${sale.channel ? "/penjualan/online/baru" : "/kasir"}?replace_sale=${encodeURIComponent(id)}`);
  }
  redirect(`/penjualan/${id}?success=cancelled&draft_scope=${encodeURIComponent(`sale-cancel:${id}:${revision}`)}&draft_done=${encodeURIComponent(key)}`);
}

/** Penanda di alamat hanya bila jurnal dibukukan di tanggal sebelum hari ini (supaya banner bisa menyebutnya). */
function tglParam(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value < hariIniWIB() ? `&tgl=${value}` : "";
}

const SALE_METHODS = ["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"] as const;

function receiptFields(form: FormData) {
  const id = String(form.get("id") ?? "");
  const revisionText = String(form.get("revision") ?? "");
  const revision = Number(revisionText);
  const key = String(form.get("requestKey") ?? "");
  const reason = String(form.get("alasan") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !revisionText.trim() || !Number.isSafeInteger(revision) || revision < 0 || !key.trim() || key.length > 120) {
    throw new Error("Identitas penjualan tidak lengkap. Muat ulang halaman lalu coba lagi.");
  }
  return { id, revision, key, reason };
}

/** Batalkan penerimaan (gaya Accurate): uang hilang dari kas/bank, struk menjadi belum dibayar. Hanya Owner (atau peran yang dicentang Owner). */
export async function batalkanPenerimaan(form: FormData) {
  const { id, revision, key, reason } = receiptFields(form);
  if (reason.length < 3 || reason.length > 1000) throw new Error("Isi alasan membatalkan penerimaan (minimal 3 huruf).");
  if (form.get("konfirmasi") !== "ya") throw new Error("Centang kotak konfirmasi dulu: uang pembayaran akan dikeluarkan dari kas/bank dan struk menjadi belum dibayar.");
  // Tanggal efektif (kosong = hari ini). Sebelum hari ini hanya Owner/peran berizin; database yang memutuskan.
  const tanggal = bacaTanggalEfektif(form.get("tanggal"));
  const db = await createClient();
  const { data, error } = await db.rpc("cancel_pos_sale_receipt", {
    p_sale_id: id, p_expected_revision: revision, p_request_key: key, p_reason: reason, p_effective_date: tanggal,
  });
  if (error || data?.sale_id !== id || data?.unpaid !== true || !data?.cancellation_id) {
    throw new Error(error?.message ?? "Hasil pembatalan penerimaan belum terkonfirmasi. Coba lagi dengan formulir yang sama.");
  }
  revalidatePath("/", "layout");
  // Efek laci jatuh di shift asal (terbuka), di shift terbuka PELAKU ("lain" dari shift asal), atau tidak di laci mana pun ("tanpa": ada uang tunai tetapi pelaku tanpa shift terbuka).
  const other = data.effect_in_other_shift === true ? "&shift=lain" : data.shift_mode === "tanpa_shift" ? "&shift=tanpa" : "";
  redirect(`/penjualan/${id}?success=receipt-cancelled${other}${tglParam(data.effective_date)}&draft_scope=${encodeURIComponent(`sale-receipt-cancel:${id}:${revision}`)}&draft_done=${encodeURIComponent(key)}`);
}

/** Terima pembayaran lagi sesudah penerimaan dibatalkan: metode boleh diganti, jumlahnya harus sama dengan total struk. */
export async function terimaPembayaranUlang(form: FormData) {
  const { id, revision, key, reason } = receiptFields(form);
  const tanggal = bacaTanggalEfektif(form.get("tanggal"));
  if (perluAlasanTanggal(tanggal) && (reason.length < 3 || reason.length > 1000)) throw new Error("Isi alasan tanggal efektif mundur (minimal 3 huruf).");
  const plan = SALE_METHODS.flatMap(method => {
    const raw = form.get(`amount_${method}`);
    const amount = raw === null ? 0 : correctionMoney(raw); // kolom yang tidak dikirim = 0; basis data tetap memeriksa jumlah = total
    return amount > 0 ? [{ method, amount }] : [];
  });
  if (plan.length === 0) throw new Error("Isi jumlah pembayaran minimal satu metode.");
  const db = await createClient();
  const { data, error } = await db.rpc("receive_pos_sale_payment", {
    p_sale_id: id, p_expected_revision: revision, p_request_key: key, p_plan: plan, p_effective_date: tanggal, p_reason: reason || null,
  });
  if (error || data?.sale_id !== id || data?.unpaid !== false || !data?.journal_id) {
    throw new Error(error?.message ?? "Hasil penerimaan pembayaran belum terkonfirmasi. Coba lagi dengan formulir yang sama.");
  }
  revalidatePath("/", "layout");
  const tanpa = data.shift_mode === "tanpa_shift" ? "&shift=tanpa" : "";
  redirect(`/penjualan/${id}?success=receipt-received${tanpa}${tglParam(data.effective_date)}&draft_scope=${encodeURIComponent(`sale-receipt-receive:${id}:${revision}`)}&draft_done=${encodeURIComponent(key)}`);
}

/** Order marketplace: batalkan pencairan sehingga order kembali ke piutang marketplace (lalu bisa dicairkan ulang atau dibatalkan/diganti). */
export async function batalkanPencairan(form: FormData) {
  const { id, revision, key, reason } = receiptFields(form);
  if (reason.length < 3 || reason.length > 1000) throw new Error("Isi alasan membatalkan pencairan (minimal 3 huruf).");
  if (form.get("konfirmasi") !== "ya") throw new Error("Centang kotak konfirmasi dulu: dana pencairan akan dikeluarkan dari bank dan order kembali menjadi piutang marketplace.");
  const tanggal = bacaTanggalEfektif(form.get("tanggal"));
  const db = await createClient();
  const { data, error } = await db.rpc("cancel_online_disbursement", {
    p_sale_id: id, p_expected_revision: revision, p_request_key: key, p_reason: reason, p_effective_date: tanggal,
  });
  if (error || data?.sale_id !== id || data?.status !== "piutang" || !data?.cancellation_id) {
    throw new Error(error?.message ?? "Hasil pembatalan pencairan belum terkonfirmasi. Coba lagi dengan formulir yang sama.");
  }
  revalidatePath("/", "layout");
  redirect(`/penjualan/${id}?success=disbursement-cancelled${tglParam(data.effective_date)}&draft_scope=${encodeURIComponent(`sale-disbursement-cancel:${id}:${revision}`)}&draft_done=${encodeURIComponent(key)}`);
}
