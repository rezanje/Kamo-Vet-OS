"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function tambahStok(formData: FormData) {
  const supabase = await createClient();
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const delta = Number(formData.get("qty")) || 0;

  const back = warehouseId ? `/pos/stok?wh=${warehouseId}` : "/pos/stok";

  if (!warehouseId || !itemId) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent("Pilih gudang & item dulu")}`);
  }
  if (delta === 0) {
    redirect(`${back}&error=${encodeURIComponent("Qty tidak boleh nol")}`);
  }

  // ponytail: upsert JS-nya REPLACE qty, bukan tambah. Jadi baca qty lama dulu,
  // lalu insert/update qty + delta supaya akumulatif (stok masuk = penambahan).
  const { data: existing } = await supabase
    .from("stock")
    .select("qty")
    .eq("warehouse_id", warehouseId)
    .eq("item_id", itemId)
    .maybeSingle();

  if (existing) {
    const newQty = Number(existing.qty) + delta;
    const { error } = await supabase
      .from("stock")
      .update({ qty: newQty, updated_at: new Date().toISOString() })
      .eq("warehouse_id", warehouseId)
      .eq("item_id", itemId);
    if (error) redirect(`${back}&error=${encodeURIComponent(error.message)}`);
  } else {
    const { error } = await supabase
      .from("stock")
      .insert({ warehouse_id: warehouseId, item_id: itemId, qty: delta });
    if (error) redirect(`${back}&error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/pos/stok");
  redirect(`${back}&success=1`);
}
