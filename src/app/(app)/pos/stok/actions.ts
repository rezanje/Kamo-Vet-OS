"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { stockInAtBuyPrice, stockOut } from "@/lib/inventory";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";

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

  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(pesanPeriode)}`);

  const catatan = String(formData.get("catatan") ?? "").trim();
  const { data: wh } = await supabase
    .from("warehouses").select("branch_id").eq("id", warehouseId).maybeSingle();

  // Mutasi via lib FIFO: masuk = layer baru @ buy_price; keluar (koreksi minus) = konsumsi FIFO.
  //
  // LAWAN JURNALNYA ADALAH 5902 SELISIH PERSEDIAAN, BUKAN HUTANG USAHA.
  // Koreksi gudang bukan pembelian: tidak ada pemasok yang menagih. Versi lama
  // mengkredit 2101 Hutang Usaha, jadi tiap koreksi menambah utang ke pemasok yang
  // tidak pernah ada. Dan koreksi MINUS dulu tidak dijurnal sama sekali — stok fisik
  // turun tapi nilai persediaan di buku besar tidak ikut turun, sehingga Neraca
  // melebih-lebihkan persediaan dan kerugiannya tidak pernah muncul di Laba Rugi.
  let nilai = 0;
  if (delta > 0) {
    const { data: item } = await supabase.from("items").select("buy_price").eq("id", itemId).maybeSingle();
    nilai = Math.round((Number(item?.buy_price) || 0) * delta);
    await stockInAtBuyPrice(supabase, { warehouseId, itemId, qty: delta, source: "manual" });
  } else {
    // Nilai yang keluar = modal FIFO lapisan yang BENAR-BENAR terpakai, bukan harga
    // beli master yang bisa sudah basi.
    const { cost } = await stockOut(supabase, { warehouseId, itemId, qty: -delta, source: "manual" });
    nilai = Math.round(cost);
  }

  if (nilai > 0) {
    await postJournal(supabase, {
      tanggal: hariIniWIB(),
      deskripsi: `Koreksi stok manual${catatan ? ` — ${catatan}` : ""}`,
      source: "koreksi-stok",
      branchId: wh?.branch_id ?? null,
      lines: delta > 0
        ? [{ code: "1301", debit: nilai, credit: 0 }, { code: "5902", debit: 0, credit: nilai }]
        : [{ code: "5902", debit: nilai, credit: 0 }, { code: "1301", debit: 0, credit: nilai }],
    });
  }

  revalidatePath("/pos/stok");
  redirect(`${back}&success=1`);
}
