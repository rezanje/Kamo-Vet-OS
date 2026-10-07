"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

async function post(formData: FormData, receive: boolean) {
  const supabase = await createClient();
  const source = String(formData.get("source_transfer_id") ?? "");
  const back = receive ? `/pos/pemindahan/${source}` : "/pos/pemindahan/baru";
  let items: unknown;
  try { items = JSON.parse(String(formData.get("items") ?? "[]")); } catch { items = []; }
  const { data, error } = await supabase.rpc("post_stock_transfer_atomic", {
    p_key: String(formData.get("request_key") ?? ""), p_source: receive ? source : null,
    p_from: receive ? null : String(formData.get("from_warehouse_id") ?? ""),
    p_to: receive ? null : String(formData.get("to_warehouse_id") ?? ""),
    p_date: String(formData.get("tanggal") ?? "") || hariIniWIB(),
    p_notes: String(formData.get("keterangan") ?? "").trim() || null, p_items: items,
  });
  if (error || !data) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Gagal menyimpan pemindahan.")}`);
  revalidatePath("/pos/pemindahan");
  redirect(`/pos/pemindahan/${receive ? source : data}?success=${encodeURIComponent("Pemindahan tersimpan.")}${transactionDraftAck(formData)}`);
}
export async function buatKirim(formData: FormData) { return post(formData, false); }
export async function terimaBarang(formData: FormData) { return post(formData, true); }
