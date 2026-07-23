"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { formatNoRetur, sisaRetur, totalRetur } from "@/lib/retur";
import { stockInAtBuyPrice } from "@/lib/inventory";

type ItemInput = { item_id: string; qty: number };

type Db = Awaited<ReturnType<typeof createClient>>;

// Retur Penjualan: barang balik dari pelanggan, refund tunai di kasir.
// Refund dicatat sebagai expenses (Tunai, shift open cabang bila ada) → kepotong di tutup shift.
// Jurnal: Dr 4101 Pendapatan, Cr 1101 Kas (refund) + Dr 1301 Persediaan, Cr 5101 HPP (stok balik).
export async function buatReturJual(formData: FormData) {
  const supabase = await createClient();

  const sale_id = String(formData.get("sale_id") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "") || new Date().toISOString().slice(0, 10);
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  let items: ItemInput[] = [];
  try { items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[]; } catch { items = []; }
  items = items.filter((it) => it.item_id && Number(it.qty) > 0);

  const fail = (msg: string) => redirect("/penjualan/retur/baru?error=" + encodeURIComponent(msg));

  if (!sale_id || items.length === 0) fail("Pilih struk dan minimal 1 barang.");

  const { data: sale } = await supabase
    .from("sales")
    .select("id, no_struk, branch_id, sale_items(item_id, qty, harga)")
    .eq("id", sale_id).single();
  if (!sale) fail("Struk tidak ditemukan.");

  // qty terjual & harga per item dari struk
  const sumber: Record<string, number> = {};
  const harga: Record<string, number> = {};
  for (const r of sale!.sale_items ?? []) {
    if (!r.item_id) continue;
    sumber[r.item_id] = (sumber[r.item_id] ?? 0) + Number(r.qty);
    harga[r.item_id] = Number(r.harga) || 0;
  }

  // akumulasi retur sebelumnya utk struk ini
  const { data: prev } = await supabase
    .from("sales_returns").select("sales_return_items(item_id, qty)").eq("sale_id", sale_id);
  const sudah: Record<string, number> = {};
  for (const d of prev ?? [])
    for (const r of d.sales_return_items ?? [])
      if (r.item_id) sudah[r.item_id] = (sudah[r.item_id] ?? 0) + Number(r.qty);

  const sisa = sisaRetur(sumber, sudah);
  for (const it of items) {
    if ((sisa[it.item_id] ?? 0) < Number(it.qty))
      fail(`Qty retur melebihi sisa yang bisa diretur (sisa ${sisa[it.item_id] ?? 0}).`);
  }

  const rows = items.map((it) => ({ item_id: it.item_id, qty: Number(it.qty), harga: harga[it.item_id] ?? 0 }));
  const total = totalRetur(rows);
  if (total <= 0) fail("Nilai retur nol.");

  const { data: { user } } = await supabase.auth.getUser();
  const no_retur = await nextNoRetur(supabase);

  const { data: itemNames } = await supabase
    .from("items").select("id, name, buy_price").in("id", items.map((it) => it.item_id));
  const nameMap = new Map((itemNames ?? []).map((r) => [r.id, r]));

  const { data: doc, error } = await supabase
    .from("sales_returns")
    .insert({ no_retur, sale_id, tanggal, keterangan, total, created_by: user?.id ?? null })
    .select("id").single();
  if (error || !doc) fail("Gagal menyimpan retur.");

  const { error: itemsErr } = await supabase.from("sales_return_items").insert(
    rows.map((r) => ({
      return_id: doc!.id, item_id: r.item_id,
      nama: (nameMap.get(r.item_id)?.name ?? "").slice(0, 160) || "—",
      qty: r.qty, harga: r.harga,
    })),
  );
  if (itemsErr) {
    console.error("retur jual: gagal insert rincian", itemsErr);
    await supabase.from("sales_returns").delete().eq("id", doc!.id);
    fail("Gagal menyimpan rincian retur.");
  }

  // refund tunai → expenses (shift open di cabang itu bila ada, biar kepotong di tutup shift)
  const { data: shift } = await supabase
    .from("cashier_shifts").select("id")
    .eq("branch_id", sale!.branch_id).eq("status", "open")
    .order("opened_at", { ascending: false }).limit(1).maybeSingle();
  const { error: expErr } = await supabase.from("expenses").insert({
    branch_id: sale!.branch_id,
    tanggal,
    kategori: "Retur Penjualan",
    deskripsi: `Refund retur ${no_retur} (struk ${sale!.no_struk ?? sale_id})`,
    jumlah: total,
    metode_bayar: "Tunai",
    shift_id: shift?.id ?? null,
    created_by: user?.id ?? null,
  });
  if (expErr) {
    // duit gak boleh gagal diam-diam — batalkan dokumen (items ikut cascade)
    console.error("retur jual: gagal catat refund", expErr);
    await supabase.from("sales_returns").delete().eq("id", doc!.id);
    fail("Gagal mencatat refund kasir.");
  }

  // stok balik ke gudang cabang penjualan (logika gudang sama dgn checkout kasir)
  const { data: wh } = await supabase
    .from("warehouses").select("id")
    .eq("branch_id", sale!.branch_id).eq("is_active", true)
    .order("type").limit(1).maybeSingle();
  if (wh) {
    // barang balik jadi layer FIFO baru @ buy_price (konsisten jurnal reversal HPP)
    for (const r of rows) {
      await stockInAtBuyPrice(supabase, {
        warehouseId: wh.id as string, itemId: r.item_id, qty: r.qty, source: "retur-jual", ref: no_retur,
      });
    }
  }

  // jurnal refund (balik pendapatan) + stok balik (balik HPP, nilai buy_price)
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Retur penjualan ${no_retur} (${sale!.no_struk ?? sale_id})`,
    source: "sales-return",
    sourceRef: no_retur,
    branchId: sale!.branch_id,
    lines: [
      { code: "4101", debit: total, credit: 0 },
      { code: "1101", debit: 0, credit: total },
    ],
  });
  const hpp = rows.reduce((a, r) => a + (Number(nameMap.get(r.item_id)?.buy_price) || 0) * r.qty, 0);
  if (hpp > 0) {
    await postJournal(supabase, {
      tanggal,
      deskripsi: `HPP retur penjualan ${no_retur}`,
      source: "sales-return-hpp",
      sourceRef: no_retur,
      branchId: sale!.branch_id,
      lines: [
        { code: "1301", debit: hpp, credit: 0 },
        { code: "5101", debit: 0, credit: hpp },
      ],
    });
  }

  revalidatePath("/penjualan/retur");
  redirect("/penjualan/retur?success=" + encodeURIComponent(`Retur ${no_retur} tersimpan.`));
}

// ponytail: nomor via count bulan berjalan +1 — pola existing (pemindahan).
async function nextNoRetur(supabase: Db) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { count } = await supabase
    .from("sales_returns").select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString());
  return formatNoRetur("RJ", now, (count ?? 0) + 1);
}

// Cari struk utk form (dipakai via query param, bukan action) — lihat baru/page.tsx.
