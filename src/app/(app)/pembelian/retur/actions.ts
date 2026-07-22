"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { formatNoRetur, sisaRetur, totalRetur } from "@/lib/retur";

type ItemInput = { item_id: string; qty: number };

type Db = Awaited<ReturnType<typeof createClient>>;

async function addQty(supabase: Db, warehouseId: string, itemId: string, delta: number) {
  const { data: st } = await supabase
    .from("stock").select("qty")
    .eq("warehouse_id", warehouseId).eq("item_id", itemId).maybeSingle();
  if (st) {
    await supabase.from("stock")
      .update({ qty: Number(st.qty) + delta, updated_at: new Date().toISOString() })
      .eq("warehouse_id", warehouseId).eq("item_id", itemId);
  } else {
    await supabase.from("stock").insert({ warehouse_id: warehouseId, item_id: itemId, qty: delta });
  }
}

// ponytail: nomor via count bulan berjalan +1 — pola existing (pemindahan).
async function nextNoRetur(supabase: Db, table: "purchase_returns" | "sales_returns", jenis: "RB" | "RJ") {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { count } = await supabase
    .from(table).select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString());
  return formatNoRetur(jenis, now, (count ?? 0) + 1);
}

// Retur Pembelian: barang keluar ke pemasok, potong hutang PO.
// Jurnal: Dr 2101 Hutang Usaha, Cr 1301 Persediaan.
export async function buatReturBeli(formData: FormData) {
  const supabase = await createClient();

  const po_id = String(formData.get("po_id") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "") || new Date().toISOString().slice(0, 10);
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  let items: ItemInput[] = [];
  try { items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[]; } catch { items = []; }
  items = items.filter((it) => it.item_id && Number(it.qty) > 0);

  const fail = (msg: string) => redirect("/pembelian/retur/baru?error=" + encodeURIComponent(msg));

  if (!po_id || items.length === 0) fail("Pilih PO dan minimal 1 barang.");

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, no_po, status, total, branch_id, to_warehouse_id, purchase_order_items(item_id, qty, harga_beli)")
    .eq("id", po_id).single();
  if (!po) fail("PO tidak ditemukan.");
  if (po!.status !== "Diterima") fail("Hanya PO berstatus Diterima yang bisa diretur.");
  if (!po!.to_warehouse_id) fail("PO tidak punya gudang tujuan.");

  // qty sumber & harga per item dari PO
  const sumber: Record<string, number> = {};
  const harga: Record<string, number> = {};
  for (const r of po!.purchase_order_items ?? []) {
    if (!r.item_id) continue;
    sumber[r.item_id] = (sumber[r.item_id] ?? 0) + Number(r.qty);
    harga[r.item_id] = Number(r.harga_beli) || 0;
  }

  // akumulasi retur sebelumnya utk PO ini
  const { data: prev } = await supabase
    .from("purchase_returns").select("purchase_return_items(item_id, qty)").eq("po_id", po_id);
  const sudah: Record<string, number> = {};
  for (const d of prev ?? [])
    for (const r of d.purchase_return_items ?? [])
      if (r.item_id) sudah[r.item_id] = (sudah[r.item_id] ?? 0) + Number(r.qty);

  const sisa = sisaRetur(sumber, sudah);
  for (const it of items) {
    if ((sisa[it.item_id] ?? 0) < Number(it.qty))
      fail(`Qty retur melebihi sisa yang bisa diretur (sisa ${sisa[it.item_id] ?? 0}).`);
  }

  const rows = items.map((it) => ({ item_id: it.item_id, qty: Number(it.qty), harga: harga[it.item_id] ?? 0 }));
  const total = totalRetur(rows);

  // guard: retur potong hutang — tidak boleh melebihi sisa hutang
  const { data: pays } = await supabase.from("po_payments").select("amount").eq("po_id", po_id);
  const dibayar = (pays ?? []).reduce((a, p) => a + Number(p.amount), 0);
  const returSebelum = (prev ?? []).length
    ? (await supabase.from("purchase_returns").select("total").eq("po_id", po_id)).data?.reduce((a, r) => a + Number(r.total), 0) ?? 0
    : 0;
  const sisaHutang = Math.max(0, Number(po!.total) - dibayar - returSebelum);
  if (total > sisaHutang)
    fail(`Nilai retur (Rp ${Math.round(total).toLocaleString("id-ID")}) melebihi sisa hutang PO (Rp ${Math.round(sisaHutang).toLocaleString("id-ID")}).`);

  // validasi stok gudang cukup utk dikeluarkan
  for (const it of items) {
    const { data: st } = await supabase
      .from("stock").select("qty")
      .eq("warehouse_id", po!.to_warehouse_id).eq("item_id", it.item_id).maybeSingle();
    if (!st || Number(st.qty) < Number(it.qty)) {
      fail(`Stok di gudang tidak cukup untuk retur (ada ${st ? Number(st.qty) : 0}).`);
    }
  }

  const { data: { user } } = await supabase.auth.getUser();
  const no_retur = await nextNoRetur(supabase, "purchase_returns", "RB");

  const { data: itemNames } = await supabase
    .from("items").select("id, name").in("id", items.map((it) => it.item_id));
  const nameMap = new Map((itemNames ?? []).map((r) => [r.id, r.name]));

  const { data: doc, error } = await supabase
    .from("purchase_returns")
    .insert({ no_retur, po_id, tanggal, keterangan, total, created_by: user?.id ?? null })
    .select("id").single();
  if (error || !doc) fail("Gagal menyimpan retur.");

  const { error: itemsErr } = await supabase.from("purchase_return_items").insert(
    rows.map((r) => ({
      return_id: doc!.id, item_id: r.item_id,
      nama: (nameMap.get(r.item_id) ?? "").slice(0, 160) || "—",
      qty: r.qty, harga: r.harga,
    })),
  );
  if (itemsErr) {
    console.error("retur beli: gagal insert rincian", itemsErr);
    await supabase.from("purchase_returns").delete().eq("id", doc!.id);
    fail("Gagal menyimpan rincian retur.");
  }

  // stok keluar dari gudang PO
  for (const r of rows) await addQty(supabase, po!.to_warehouse_id as string, r.item_id, -r.qty);

  await postJournal(supabase, {
    tanggal,
    deskripsi: `Retur pembelian ${no_retur} (${po!.no_po ?? po_id})`,
    source: "purchase-return",
    sourceRef: no_retur,
    branchId: po!.branch_id ?? null,
    lines: [
      { code: "2101", debit: total, credit: 0 },
      { code: "1301", debit: 0, credit: total },
    ],
  });

  revalidatePath("/pembelian/retur");
  redirect("/pembelian/retur?success=" + encodeURIComponent(`Retur ${no_retur} tersimpan.`));
}
