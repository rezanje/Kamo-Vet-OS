"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type ItemInput = { nama: string; qty_diminta: number };

export async function buatPermintaan(formData: FormData) {
  const supabase = await createClient();

  const from_branch_id = String(formData.get("from_branch_id") ?? "");
  const to_warehouse_id = String(formData.get("to_warehouse_id") ?? "");
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  let items: ItemInput[] = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[];
  } catch {
    items = [];
  }
  // hanya baris dengan nama terisi yang dipakai.
  items = items.filter((it) => (it.nama ?? "").trim().length > 0);

  if (!from_branch_id || !to_warehouse_id || items.length === 0) {
    redirect("/pos/permintaan/baru?error=" + encodeURIComponent("Cabang, gudang, dan minimal 1 item wajib diisi."));
  }

  // no_request = PRM-YYYYMMDD-NNNN (urutan hari ini +1, padded 4). Today 2026-07-01.
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const ymd = `${y}${m}${d}`;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("stock_requests")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startOfDay.toISOString());
  const seq = String((count ?? 0) + 1).padStart(4, "0");
  const no_request = `PRM-${ymd}-${seq}`;

  const { data: req, error: reqErr } = await supabase
    .from("stock_requests")
    .insert({ no_request, from_branch_id, to_warehouse_id, catatan })
    .select("id")
    .single();

  if (reqErr || !req) {
    redirect("/pos/permintaan/baru?error=" + encodeURIComponent("Gagal menyimpan permintaan."));
  }

  const rows = items.map((it) => ({
    request_id: (req as { id: string }).id,
    nama: String(it.nama).slice(0, 160),
    qty_diminta: Number(it.qty_diminta) || 0,
  }));
  await supabase.from("stock_request_items").insert(rows);

  revalidatePath("/pos/permintaan");
  redirect("/pos/permintaan?success=1");
}

export async function updateRequestStatus(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  await supabase.from("stock_requests").update({ status }).eq("id", id);
  revalidatePath("/pos/permintaan");
}
