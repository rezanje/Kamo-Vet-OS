"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { receiptSummary } from "@/lib/stock-recon";

type TerimaRow = { id: string; item_id: string | null; nama: string; qty_diminta: number; qty_diterima: number; kondisi: string; notes?: string };

// Penerimaan barang klinik (mirror kasir/persediaan.terimaBarang, scope shift klinik).
export async function terimaBarangKlinik(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const shift = await getOpenShift(supabase as never, user.id, "klinik");
  if (!shift) redirect("/klinik/shift");

  const requestId = String(formData.get("request_id") ?? "");
  if (!requestId) redirect("/klinik/penerimaan");

  let rows: TerimaRow[] = [];
  try { rows = JSON.parse(String(formData.get("items") ?? "[]")); } catch { rows = []; }

  const now = new Date();
  const ymd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const { count } = await supabase.from("stock_receipts").select("id", { count: "exact", head: true }).like("receipt_number", `TRM-${ymd}-%`);
  const receiptNumber = `TRM-${ymd}-${String((count ?? 0) + 1).padStart(3, "0")}`;

  const { data: receipt, error: recErr } = await supabase
    .from("stock_receipts")
    .insert({ receipt_number: receiptNumber, stock_request_id: requestId, received_by: user.id })
    .select("id").single();
  if (recErr || !receipt) redirect(`/klinik/penerimaan?error=${encodeURIComponent(recErr?.message ?? "Gagal buat dokumen penerimaan")}`);

  await supabase.from("stock_receipt_items").insert(
    rows.map((r) => ({
      stock_receipt_id: receipt!.id, item_id: r.item_id, nama: String(r.nama ?? "").slice(0, 160) || "—",
      qty_ordered: Number(r.qty_diminta) || 0, qty_received: Number(r.qty_diterima) || 0,
      condition: (r.kondisi || "baik").toLowerCase(), notes: (r.notes ?? "").trim() || null,
    })),
  );
  for (const row of rows) {
    await supabase.from("stock_request_items").update({ qty_diterima: Number(row.qty_diterima) || 0, kondisi: row.kondisi || null }).eq("id", row.id);
  }
  await supabase.from("stock_requests").update({ status: "Selesai" }).eq("id", requestId);

  // Stok gudang cabang klinik bertambah (hanya kondisi baik).
  const { data: wh } = await supabase
    .from("warehouses").select("id").eq("branch_id", shift.branch_id).eq("is_active", true).order("code").limit(1).maybeSingle();
  if (wh) {
    for (const row of rows) {
      if (!row.item_id || (row.kondisi || "baik").toLowerCase() !== "baik") continue;
      const qty = Number(row.qty_diterima) || 0;
      if (qty <= 0) continue;
      const { data: existing } = await supabase.from("stock").select("qty").eq("warehouse_id", wh.id).eq("item_id", row.item_id).maybeSingle();
      if (existing) {
        await supabase.from("stock").update({ qty: Number(existing.qty) + qty, updated_at: new Date().toISOString() }).eq("warehouse_id", wh.id).eq("item_id", row.item_id);
      } else {
        await supabase.from("stock").insert({ warehouse_id: wh.id, item_id: row.item_id, qty });
      }
    }
  }

  const summary = receiptSummary(rows.map((r) => ({ qty_ordered: Number(r.qty_diminta) || 0, qty_received: Number(r.qty_diterima) || 0 })));
  revalidatePath("/klinik/penerimaan");
  redirect(`/klinik/penerimaan?success=terima&trm=${receiptNumber}&selisih=${summary.selisih}`);
}
