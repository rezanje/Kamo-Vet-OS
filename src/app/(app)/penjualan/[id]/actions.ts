"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function correctionMoney(value: FormDataEntryValue | null): number {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(text)) throw new Error("Jumlah koreksi tidak valid. Isi angka Rupiah dengan maksimal dua desimal.");
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount > 1_000_000_000_000 || !Number.isSafeInteger(Math.round(amount * 100))) {
    throw new Error("Jumlah koreksi tidak valid. Muat ulang lalu coba lagi.");
  }
  return amount;
}

export async function koreksiMetodePembayaran(form: FormData) {
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
