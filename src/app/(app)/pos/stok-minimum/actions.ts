"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadUnitOptions, pickUnit } from "@/lib/satuan";
import { urutanBerikutnya } from "@/lib/no-dokumen";

const BACK = "/pos/stok-minimum";

// Draft PO dari usulan pesan. Dibuat DRAFT, bukan langsung "Dipesan": angka
// usulan itu hitungan mesin, pembeli tetap harus melihatnya sebelum dikirim.
export async function buatPOdariUsulan(formData: FormData) {
  const supabase = await createClient();

  const warehouseId = String(formData.get("warehouse_id") ?? "").trim();
  if (!warehouseId) redirect(`${BACK}?error=${encodeURIComponent("Pilih gudang tujuan dulu")}`);

  // Baris terpilih: `pilih` = "<item_id>|<supplier_id>|<qty satuan beli>".
  const dipilih = formData.getAll("pilih").map(String).filter(Boolean);
  if (dipilih.length === 0) redirect(`${BACK}?gudang=${warehouseId}&error=${encodeURIComponent("Centang dulu barang yang mau dipesan")}`);

  const { data: wh } = await supabase
    .from("warehouses").select("id, branch_id").eq("id", warehouseId).maybeSingle();
  if (!wh) redirect(`${BACK}?error=${encodeURIComponent("Gudang tidak valid")}`);

  type Baris = { itemId: string; supplierId: string | null; qty: number };
  const baris: Baris[] = dipilih.map((s) => {
    const [itemId, supplierId, qty] = s.split("|");
    return { itemId, supplierId: supplierId || null, qty: Number(qty) || 0 };
  }).filter((b) => b.itemId && b.qty > 0);
  if (baris.length === 0) redirect(`${BACK}?gudang=${warehouseId}&error=${encodeURIComponent("Qty pesan tidak valid")}`);

  // Nama, harga & satuan beli diambil ULANG dari master — halaman cuma mengusulkan
  // qty; harga yang ikut dari layar tidak boleh jadi sumber kebenaran nilai PO.
  const ids = [...new Set(baris.map((b) => b.itemId))];
  const [{ data: itemRows }, unitOpts] = await Promise.all([
    supabase.from("items").select("id, name, unit, buy_unit, buy_price").in("id", ids),
    loadUnitOptions(supabase, ids),
  ]);
  const master = new Map(
    ((itemRows ?? []) as { id: string; name: string; unit: string; buy_unit: string | null; buy_price: number }[])
      .map((i) => [i.id, i]),
  );

  // Satu PO per pemasok.
  const perPemasok = new Map<string, Baris[]>();
  for (const b of baris) {
    const k = b.supplierId ?? "";
    perPemasok.set(k, [...(perPemasok.get(k) ?? []), b]);
  }

  const tanggal = new Date(new Date().getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const ymd = tanggal.replace(/-/g, "");
  const prefixPo = `PO-${ymd}-`;
  let seq = await urutanBerikutnya(supabase, {
    table: "purchase_orders", column: "no_po", prefix: prefixPo, pad: 4,
  }) - 1;
  let dibuat = 0;

  for (const [supplierKey, rows] of perPemasok) {
    seq += 1;
    const no_po = `PO-${ymd}-${String(seq).padStart(4, "0")}`;

    const lines = rows.map((b) => {
      const it = master.get(b.itemId);
      const opts = unitOpts.get(b.itemId);
      const u = opts ? pickUnit(opts, it?.buy_unit ?? it?.unit ?? null) : null;
      const harga = u ? (Number(u.buy_price) || Number(it?.buy_price) || 0) : Number(it?.buy_price) || 0;
      return {
        item_id: b.itemId,
        nama: it?.name ?? "Barang",
        qty: b.qty,
        harga_beli: harga,
        satuan: u?.unit ?? it?.unit ?? null,
        faktor: u?.factor ?? 1,
      };
    });
    const total = lines.reduce((a, l) => a + l.qty * l.harga_beli, 0);

    const { data: po, error: poErr } = await supabase
      .from("purchase_orders")
      .insert({
        no_po, supplier_id: supplierKey || null, to_warehouse_id: warehouseId,
        branch_id: wh.branch_id, tanggal, total, status: "Draft",
      })
      .select("id").single();
    if (poErr || !po) {
      redirect(`${BACK}?gudang=${warehouseId}&error=${encodeURIComponent(`Gagal membuat PO: ${poErr?.message ?? "tidak diketahui"}`)}`);
    }

    const { error: itErr } = await supabase.from("purchase_order_items")
      .insert(lines.map((l) => ({ po_id: po!.id, ...l })));
    if (itErr) {
      redirect(`${BACK}?gudang=${warehouseId}&error=${encodeURIComponent(`Gagal mengisi PO: ${itErr.message}`)}`);
    }
    dibuat += 1;
  }

  redirect(`/pembelian?success=${encodeURIComponent(`${dibuat} draft PO dibuat dari usulan stok minimum`)}`);
}
