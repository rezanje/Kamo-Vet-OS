"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { stockInAtBuyPrice, stockOut } from "@/lib/inventory";

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

  // Mutasi via lib FIFO: masuk = layer baru @ buy_price; keluar (koreksi minus) = konsumsi FIFO.
  if (delta > 0) {
    await stockInAtBuyPrice(supabase, { warehouseId, itemId, qty: delta, source: "manual" });
  } else {
    await stockOut(supabase, { warehouseId, itemId, qty: -delta, source: "manual" });
  }

  // Loop inventory: stok masuk (delta>0) dijurnal sbg pembelian persediaan →
  // Dr Persediaan / Cr Hutang Usaha = qty × buy_price. Menambah sisi Persediaan
  // (HPP penjualan menguranginya).
  if (delta > 0) {
    const { data: item } = await supabase.from("items").select("buy_price").eq("id", itemId).maybeSingle();
    const { data: wh } = await supabase.from("warehouses").select("branch_id").eq("id", warehouseId).maybeSingle();
    const nilai = Math.round((Number(item?.buy_price) || 0) * delta);
    if (nilai > 0) {
      await postJournal(supabase, {
        tanggal: new Date().toISOString().slice(0, 10),
        deskripsi: "Stok masuk (pembelian persediaan)",
        source: "stock-in",
        branchId: wh?.branch_id ?? null,
        lines: [
          { code: "1301", debit: nilai, credit: 0 },
          { code: "2101", debit: 0, credit: nilai },
        ],
      });
    }
  }

  revalidatePath("/pos/stok");
  redirect(`${back}&success=1`);
}
