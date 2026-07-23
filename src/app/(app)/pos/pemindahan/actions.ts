"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatNoPemindahan, hitungStatusKirim, sisaTransit } from "@/lib/pemindahan";
import { transferStock } from "@/lib/inventory";

type ItemInput = { item_id: string; qty: number };

type Db = Awaited<ReturnType<typeof createClient>>;

async function getQty(supabase: Db, warehouseId: string, itemId: string): Promise<number> {
  const { data } = await supabase
    .from("stock").select("qty")
    .eq("warehouse_id", warehouseId).eq("item_id", itemId).maybeSingle();
  return data ? Number(data.qty) : 0;
}

// Gudang Transit tunggal per perusahaan (meniru "Transit (AOL System)" Accurate).
// Lazy find-or-create biar tidak bergantung seed migrasi.
async function getTransitWarehouse(supabase: Db, fallbackBranchId: string): Promise<string> {
  const { data: wh } = await supabase
    .from("warehouses").select("id").eq("type", "TRANSIT").limit(1).maybeSingle();
  if (wh) return wh.id as string;
  const { data: created, error } = await supabase
    .from("warehouses")
    .insert({ branch_id: fallbackBranchId, code: "TRANSIT", name: "Transit (VetOS System)", type: "TRANSIT" })
    .select("id").single();
  if (error || !created) throw new Error("Gagal menyiapkan gudang Transit.");
  return created.id as string;
}

// ponytail: nomor via count bulan berjalan +1 — pola existing (pos/permintaan); counter table kalau kelak sering tabrakan.
async function nextNoPemindahan(supabase: Db): Promise<string> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { count } = await supabase
    .from("stock_transfers")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString());
  return formatNoPemindahan(now, (count ?? 0) + 1);
}

// ================= Kirim Barang =================
export async function buatKirim(formData: FormData) {
  const supabase = await createClient();

  const from_warehouse_id = String(formData.get("from_warehouse_id") ?? "");
  const to_warehouse_id = String(formData.get("to_warehouse_id") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "") || new Date().toISOString().slice(0, 10);
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  let items: ItemInput[] = [];
  try { items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[]; } catch { items = []; }
  items = items.filter((it) => it.item_id && Number(it.qty) > 0);

  const fail = (msg: string) => redirect("/pos/pemindahan/baru?error=" + encodeURIComponent(msg));

  if (!from_warehouse_id || !to_warehouse_id || items.length === 0)
    fail("Gudang asal, gudang tujuan, dan minimal 1 barang wajib diisi.");
  if (from_warehouse_id === to_warehouse_id)
    fail("Gudang asal dan tujuan tidak boleh sama.");

  // validasi stok gudang asal cukup
  for (const it of items) {
    const ada = await getQty(supabase, from_warehouse_id, it.item_id);
    if (ada < it.qty) {
      const { data: item } = await supabase.from("items").select("name").eq("id", it.item_id).maybeSingle();
      fail(`Stok "${item?.name ?? it.item_id}" di gudang asal kurang (ada ${ada}, mau kirim ${it.qty}).`);
    }
  }

  const { data: fromWh } = await supabase
    .from("warehouses").select("branch_id").eq("id", from_warehouse_id).single();
  if (!fromWh) fail("Gudang asal tidak ditemukan.");
  const transitId = await getTransitWarehouse(supabase, fromWh!.branch_id as string);

  const { data: { user } } = await supabase.auth.getUser();
  const no_pemindahan = await nextNoPemindahan(supabase);

  const { data: doc, error } = await supabase
    .from("stock_transfers")
    .insert({
      no_pemindahan, proses: "Kirim Barang", tanggal,
      from_warehouse_id, to_warehouse_id, keterangan,
      status: "Sedang dikirim", created_by: user?.id ?? null,
    })
    .select("id").single();
  if (error || !doc) fail("Gagal menyimpan dokumen pemindahan.");

  const { error: itemsErr } = await supabase.from("stock_transfer_items").insert(
    items.map((it) => ({ transfer_id: doc!.id, item_id: it.item_id, qty: Number(it.qty) })),
  );
  if (itemsErr) {
    console.error("pemindahan: gagal insert rincian kirim", itemsErr);
    await supabase.from("stock_transfers").delete().eq("id", doc!.id);
    fail("Gagal menyimpan rincian barang.");
  }

  // stok: asal -> Transit (cost FIFO ikut barang)
  for (const it of items) {
    await transferStock(supabase, {
      fromWarehouseId: from_warehouse_id, toWarehouseId: transitId,
      itemId: it.item_id, qty: Number(it.qty), source: "transfer", ref: no_pemindahan, tanggal,
    });
  }

  revalidatePath("/pos/pemindahan");
  redirect(`/pos/pemindahan/${doc!.id}?success=` + encodeURIComponent(`Kirim barang ${no_pemindahan} tersimpan.`));
}

// ================= Terima Barang =================
export async function terimaBarang(formData: FormData) {
  const supabase = await createClient();

  const source_transfer_id = String(formData.get("source_transfer_id") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "") || new Date().toISOString().slice(0, 10);

  let items: ItemInput[] = [];
  try { items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[]; } catch { items = []; }
  items = items.filter((it) => it.item_id && Number(it.qty) > 0);

  const fail = (msg: string) =>
    redirect(`/pos/pemindahan/${source_transfer_id}?error=` + encodeURIComponent(msg));

  if (!source_transfer_id || items.length === 0) fail("Pilih minimal 1 barang yang diterima.");

  const { data: kirim } = await supabase
    .from("stock_transfers")
    .select("id, no_pemindahan, proses, status, from_warehouse_id, to_warehouse_id, stock_transfer_items(item_id, qty)")
    .eq("id", source_transfer_id).single();
  if (!kirim || kirim.proses !== "Kirim Barang") fail("Dokumen kirim tidak ditemukan.");
  if (kirim!.status === "Dibatalkan") fail("Dokumen sudah dibatalkan.");

  // sisa di Transit = dikirim - sudah diterima (semua dokumen Terima sebelumnya)
  const dikirim: Record<string, number> = {};
  for (const r of kirim!.stock_transfer_items ?? []) dikirim[r.item_id] = (dikirim[r.item_id] ?? 0) + Number(r.qty);

  const { data: prev } = await supabase
    .from("stock_transfers")
    .select("stock_transfer_items(item_id, qty)")
    .eq("source_transfer_id", source_transfer_id);
  const diterima: Record<string, number> = {};
  for (const d of prev ?? [])
    for (const r of d.stock_transfer_items ?? []) diterima[r.item_id] = (diterima[r.item_id] ?? 0) + Number(r.qty);

  const sisa = sisaTransit(dikirim, diterima);
  for (const it of items) {
    if ((sisa[it.item_id] ?? 0) < Number(it.qty))
      fail(`Qty diterima melebihi sisa kiriman (sisa ${sisa[it.item_id] ?? 0}).`);
  }

  const { data: fromWh } = await supabase
    .from("warehouses").select("branch_id").eq("id", kirim!.from_warehouse_id).single();
  const transitId = await getTransitWarehouse(supabase, fromWh!.branch_id as string);

  const { data: { user } } = await supabase.auth.getUser();
  const no_pemindahan = await nextNoPemindahan(supabase);

  const { data: doc, error } = await supabase
    .from("stock_transfers")
    .insert({
      no_pemindahan, proses: "Terima Barang", tanggal,
      from_warehouse_id: kirim!.from_warehouse_id, to_warehouse_id: kirim!.to_warehouse_id,
      source_transfer_id, created_by: user?.id ?? null,
    })
    .select("id").single();
  if (error || !doc) fail("Gagal menyimpan dokumen penerimaan.");

  const { error: itemsErr } = await supabase.from("stock_transfer_items").insert(
    items.map((it) => ({ transfer_id: doc!.id, item_id: it.item_id, qty: Number(it.qty) })),
  );
  if (itemsErr) {
    console.error("pemindahan: gagal insert rincian terima", itemsErr);
    await supabase.from("stock_transfers").delete().eq("id", doc!.id);
    fail("Gagal menyimpan rincian penerimaan.");
  }

  // stok: Transit -> tujuan (cost FIFO ikut barang)
  for (const it of items) {
    await transferStock(supabase, {
      fromWarehouseId: transitId, toWarehouseId: kirim!.to_warehouse_id,
      itemId: it.item_id, qty: Number(it.qty), source: "transfer", ref: no_pemindahan, tanggal,
    });
  }

  // update status dokumen Kirim
  const totalDikirim = Object.values(dikirim).reduce((a, b) => a + b, 0);
  const totalDiterima =
    Object.values(diterima).reduce((a, b) => a + b, 0) +
    items.reduce((a, it) => a + Number(it.qty), 0);
  await supabase.from("stock_transfers")
    .update({ status: hitungStatusKirim(totalDikirim, totalDiterima) })
    .eq("id", source_transfer_id);

  revalidatePath("/pos/pemindahan");
  redirect(`/pos/pemindahan/${source_transfer_id}?success=` + encodeURIComponent(`Terima barang ${no_pemindahan} tersimpan.`));
}
