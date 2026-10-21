"use server";

import { revalidatePath } from "next/cache";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { hariIniWIB } from "@/lib/tanggal";

const BASE = "/pembelian/perintah-bayar";
const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

async function mutateOrder(formData: FormData, action: "create" | "approve" | "cancel") {
  const supabase = await assertRole(BASE, "perintah pembayaran", action === "create" ? ["OWNER", "ADMIN", "FINANCE"] : ["OWNER", "ADMIN"]);
  const items: { invoice_id: string; jumlah: number }[] = [];
  if (action === "create") {
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("pilih_") || String(value) !== "on") continue;
      const invoice_id = key.slice(6);
      const jumlah = Number(formData.get(`jumlah_${invoice_id}`));
      if (!Number.isSafeInteger(jumlah) || jumlah <= 0) gagal("Nominal pembayaran harus rupiah bulat positif.");
      items.push({ invoice_id, jumlah });
    }
    if (!items.length) gagal("Pilih minimal satu faktur.");
  }
  const { data, error } = await supabase.rpc("mutate_purchase_payment_order", {
    p_request_key: String(formData.get("draft_key") ?? ""), p_action: action,
    p_order_id: action === "create" ? null : String(formData.get("id") ?? ""),
    p_expected_revision: action === "create" ? null : Number(formData.get("revision")),
    p_header: action === "create" ? {
      supplier_id: String(formData.get("supplier_id") ?? ""),
      rencana_bayar: String(formData.get("rencana_bayar") ?? "").trim() || null,
      catatan: String(formData.get("catatan") ?? "").trim() || null,
    } : {},
    p_items: items.sort((a, b) => a.invoice_id.localeCompare(b.invoice_id)),
  });
  if (error) gagal(error.message);
  if (!data?.order_id || !data?.no_pp) throw new Error("Perintah bayar belum terkonfirmasi. Periksa hasil sebelum mengulang.");
  revalidatePath(BASE);
  const status = action === "create" ? "dibuat, menunggu persetujuan" : action === "approve" ? "disetujui" : "dibatalkan";
  redirect(`${BASE}?success=${encodeURIComponent(`${data.no_pp} ${status}.`)}${transactionDraftAck(formData)}`);
}

export async function buatPerintahBayar(formData: FormData) { await mutateOrder(formData, "create"); }
export async function setujuiPerintahBayar(formData: FormData) { await mutateOrder(formData, "approve"); }
export async function batalkanPerintahBayar(formData: FormData) { await mutateOrder(formData, "cancel"); }

export async function bayarPerintahBayar(formData: FormData) {
  const supabase = await assertRole(BASE, "pembayaran hutang", ["OWNER", "ADMIN"]);
  const id = String(formData.get("id") ?? "").trim();
  const key = String(formData.get("draft_key") ?? "");
  if (!id || !key) gagal("Identitas perintah bayar tidak valid. Muat ulang formulir.");
  const { data, error } = await supabase.rpc("pay_purchase_payment_order_atomic", {
    p_request_key: key, p_order_id: id, p_expected_revision: Number(formData.get("revision")),
    p_tanggal: String(formData.get("tanggal") ?? "").trim() || hariIniWIB(),
    p_metode: String(formData.get("metode") ?? "Transfer"),
    p_account_id: String(formData.get("account_id") ?? "").trim() || null,
  });
  if (error) gagal(error.message);
  if (!data?.order_id || !data?.journal_id || !data?.no_pp) throw new Error("Pembayaran belum terkonfirmasi lengkap. Periksa perintah bayar sebelum menyimpan ulang.");
  revalidatePath(BASE); revalidatePath("/keuangan/hutang"); revalidatePath("/pembelian/faktur");
  redirect(`${BASE}?success=${encodeURIComponent(`${data.no_pp} dibayar.`)}${transactionDraftAck(formData)}`);
}
