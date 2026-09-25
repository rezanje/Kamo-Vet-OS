"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { rencanakanRepriceLapisan, sisaFakturablePerBaris, type ItemFakturPoTersimpan, type LapisanStokFaktur, type PoItemUntukFaktur } from "@/lib/faktur-beli";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { totalRetur } from "@/lib/retur";
import { jurnalBayarHutang, pakaiUangMuka } from "@/lib/uang-muka";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";
import { cekPersetujuan } from "@/lib/persetujuan-server";
import { toBaseCost, toBaseQty } from "@/lib/satuan";

type ItemInput = { po_item_id: string; qty: number; harga: number };
type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>): T | null => Array.isArray(value) ? value[0] ?? null : value;

type PoLine = {
  id: string; item_id: string | null; nama: string; qty: number; qty_terima: number | null;
  harga_beli: number; satuan: string | null; faktor: number | null;
  items: Rel<{ unit: string | null }>;
};

// Buat Faktur Pembelian dari PO Diterima. Harga/qty boleh beda dari PO (faktur pemasok).
// Jurnal: Dr 2102 (nilai PO porsi difakturkan) / Cr 2101 (nilai faktur); selisih -> 1301.
export async function buatFaktur(formData: FormData) {
  const supabase = await createClient();

  const po_id = String(formData.get("po_id") ?? "");
  const no_faktur_pemasok = String(formData.get("no_faktur_pemasok") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "") || hariIniWIB();
  const jatuh_tempo = String(formData.get("jatuh_tempo") ?? "") || tanggal;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  let items: ItemInput[] = [];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("items") ?? "[]"));
    if (Array.isArray(parsed)) items = parsed as ItemInput[];
  } catch { items = []; }

  const fail = (msg: string): never => redirect("/pembelian/faktur/baru?error=" + encodeURIComponent(msg));

  if (!po_id || items.length === 0) fail("Pilih PO dan minimal 1 barang.");
  if (items.some((it) => !it || typeof it.po_item_id !== "string" || !it.po_item_id
    || !Number.isFinite(Number(it.qty)) || Number(it.qty) < 0
    || !Number.isFinite(Number(it.harga)) || Number(it.harga) < 0)) {
    fail("Rincian faktur tidak valid. Muat ulang PO lalu periksa jumlah dan harga.");
  }
  items = items.filter((it) => Number(it.qty) > 0);
  if (items.length === 0) fail("Isi qty faktur lebih dari 0 pada minimal 1 baris PO.");
  if (new Set(items.map((it) => it.po_item_id)).size !== items.length) {
    fail("Baris PO yang sama tercantum lebih dari sekali. Muat ulang faktur.");
  }

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) fail(pesanPeriode);

  const { data: po, error: poError } = await supabase
    .from("purchase_orders")
    .select("id, no_po, status, supplier_id, branch_id, to_warehouse_id, purchase_order_items(id, item_id, nama, qty, qty_terima, harga_beli, satuan, faktor, items(unit))")
    .eq("id", po_id).single();
  if (poError || !po) fail("PO tidak ditemukan atau tidak dapat dibaca.");
  if (po!.status !== "Diterima") fail("Hanya PO berstatus Diterima yang bisa difakturkan.");

  const poLines = (po!.purchase_order_items ?? []) as unknown as PoLine[];
  const poLineById = new Map(poLines.map((line) => [line.id, line]));
  const poMath: PoItemUntukFaktur[] = poLines.map((line) => ({
    id: line.id,
    item_id: line.item_id,
    diterima: Number(line.qty_terima ?? line.qty),
    faktor: Number(line.faktor),
  }));

  // Baris faktur bertaut per PO item; faktur lama yang belum punya tautan
  // dialokasikan hanya bila SKU muncul sekali di PO itu.
  const { data: prev, error: prevError } = await supabase
    .from("purchase_invoices")
    .select("purchase_invoice_items(po_item_id, item_id, qty, faktor)")
    .eq("po_id", po_id);
  if (prevError) fail("Faktur sebelumnya tidak dapat diperiksa; coba lagi sebelum membuat faktur baru.");
  const previousLines = ((prev ?? []) as unknown as { purchase_invoice_items: ItemFakturPoTersimpan[] | null }[])
    .flatMap((invoice) => invoice.purchase_invoice_items ?? []);
  const remaining = sisaFakturablePerBaris(poMath, previousLines);
  if (remaining.invalidLinkedLines) fail("Ada faktur lama dengan tautan ke baris PO yang tidak valid. Minta keuangan meninjau PO ini.");

  const seenItems = new Set<string>();
  const rows = items.map((input) => {
    const poLine = poLineById.get(input.po_item_id);
    if (!poLine) return fail("Baris faktur bukan bagian dari PO ini.");
    const itemId = poLine.item_id;
    if (!itemId) return fail("Baris PO tidak terhubung ke master barang.");
    if (seenItems.has(input.po_item_id)) fail("Baris PO yang sama tercantum lebih dari sekali.");
    seenItems.add(input.po_item_id);
    if (remaining.legacyAmbiguousItemIds.includes(itemId)) {
      fail(`SKU ${poLine.nama} memiliki faktur lama yang tidak dapat dipetakan ke satuan PO. Minta keuangan meninjau faktur lama.`);
    }
    if (remaining.invalidPoItemIds.includes(poLine.id)) fail(`Satuan atau faktor ${poLine.nama} tidak valid pada PO/faktur sebelumnya.`);
    const maxQty = remaining.sisaPerBaris[poLine.id] ?? 0;
    const qty = Number(input.qty);
    if (qty > maxQty + 1e-9) fail(`Qty faktur ${poLine.nama} melebihi sisa baris PO (${maxQty}).`);
    const faktor = Number(poLine.faktor);
    if (!Number.isFinite(faktor) || faktor <= 0) fail(`Faktor satuan ${poLine.nama} tidak valid pada PO.`);
    return {
      po_item_id: poLine.id,
      item_id: itemId,
      nama: (poLine.nama ?? "").slice(0, 160) || "—",
      qty,
      harga: Number(input.harga),
      satuan: poLine.satuan || one(poLine.items)?.unit || "unit",
      faktor,
      hargaPo: Number(poLine.harga_beli) || 0,
    };
  });
  const total = totalRetur(rows); // Σ qty × harga (fungsi generik)
  if (total <= 0) fail("Nilai faktur nol.");
  const { ppn } = splitPpnInklusif(total, await getPajakSettings(supabase));
  const rasioDpp = total > 0 ? (total - ppn) / total : 1;

  const noPo = (po!.no_po as string | null) ?? po_id;
  const warehouseId = po!.to_warehouse_id as string | null;

  // Rencanakan perubahan layer sebelum invoice ditulis. Beberapa baris PO untuk
  // SKU dan HPP dasar yang sama hanya aman digabung jika harga faktur per unit
  // dasarnya juga sama; layer lama belum menyimpan ID baris PO.
  const repriceRows = rows.filter((r) =>
    Math.abs(toBaseCost(r.hargaPo, r.faktor) - toBaseCost(r.harga * rasioDpp, r.faktor)) >= 1e-9);
  if (repriceRows.length > 0 && !warehouseId) fail("Gudang tujuan PO tidak ditemukan; harga stok tidak bisa disesuaikan dengan aman.");
  const layersByItem = new Map<string, LapisanStokFaktur[]>();
  for (const r of repriceRows) {
    if (layersByItem.has(r.item_id)) continue;
    const { data: layers, error: layerError } = await supabase
      .from("stock_layers")
      .select("id, warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost, source, source_ref, exp_date, batch_no")
      .eq("warehouse_id", warehouseId!)
      .eq("item_id", r.item_id)
      .eq("source", "purchase")
      .eq("source_ref", noPo)
      .gt("qty_left", 0)
      .order("tanggal")
      .order("created_at");
    if (layerError) fail("Lapisan stok PO tidak dapat diperiksa. Tidak ada faktur yang disimpan.");
    layersByItem.set(r.item_id, (layers ?? []) as unknown as LapisanStokFaktur[]);
  }

  const groupsByItemAndCost = new Map<string, typeof repriceRows>();
  for (const r of repriceRows) {
    const oldCost = toBaseCost(r.hargaPo, r.faktor);
    const key = `${r.item_id}:${oldCost}`;
    const group = groupsByItemAndCost.get(key) ?? [];
    group.push(r);
    groupsByItemAndCost.set(key, group);
  }
  const layerUpdates: ReturnType<typeof rencanakanRepriceLapisan>["updates"] = [];
  const layerInserts: ReturnType<typeof rencanakanRepriceLapisan>["inserts"] = [];
  for (const group of groupsByItemAndCost.values()) {
    const first = group[0];
    const oldCost = toBaseCost(first.hargaPo, first.faktor);
    const matchingLayers = (layersByItem.get(first.item_id) ?? [])
      .filter((layer) => Math.abs(Number(layer.unit_cost) - oldCost) < 1e-6);
    const newCosts: number[] = [];
    for (const row of group) {
      // PPN Masukan yang dapat dikreditkan bukan bagian dari harga pokok.
      const cost = toBaseCost(row.harga * rasioDpp, row.faktor);
      if (!newCosts.some((existing) => Math.abs(existing - cost) < 1e-9)) newCosts.push(cost);
    }
    if (newCosts.length > 1 && matchingLayers.some((layer) => Number(layer.qty_left) > 0)) {
      fail(`Harga ${first.nama} berbeda untuk baris PO dengan HPP dasar sama, sementara layer stoknya belum punya tautan baris PO. Minta keuangan meninjau faktur ini.`);
    }
    if (newCosts.length !== 1) continue;
    const qtyBase = group.reduce((sum, row) => sum + toBaseQty(row.qty, row.faktor), 0);
    const plan = rencanakanRepriceLapisan(matchingLayers, qtyBase, newCosts[0]);
    layerUpdates.push(...plan.updates);
    layerInserts.push(...plan.inserts);
  }

  const { prefix, digit } = await nomorBerikutnya(supabase, "FB", tanggal, {
    table: "purchase_invoices", column: "no_faktur",
  });
  const { data: result, error: createError } = await supabase.rpc("create_purchase_invoice_from_po", {
    p_po_id: po_id,
    p_no_faktur_prefix: prefix,
    p_no_faktur_digits: digit,
    p_no_faktur_pemasok: no_faktur_pemasok,
    p_tanggal: tanggal,
    p_jatuh_tempo: jatuh_tempo,
    p_keterangan: keterangan,
    p_items: rows.map((r) => ({
      po_item_id: r.po_item_id,
      qty: r.qty,
      harga: r.harga,
      expected_harga_po: r.hargaPo,
      expected_faktor: r.faktor,
    })),
    p_layer_updates: layerUpdates,
    p_layer_inserts: layerInserts,
    p_ppn: ppn,
  });
  if (createError) {
    console.error("faktur beli: transaksi atomik gagal", createError);
    fail("Faktur tidak tersimpan. Periksa sisa PO dan lapisan stok, lalu muat ulang sebelum mencoba lagi.");
  }
  const created = Array.isArray(result) ? result[0] : result;
  if (!created?.no_faktur) fail("Faktur tidak tersimpan. Coba muat ulang halaman.");

  revalidatePath("/pembelian/faktur");
  revalidatePath("/keuangan/hutang");
  redirect("/pembelian/faktur?success=" + encodeURIComponent(`Faktur ${created.no_faktur} tersimpan.`));
}

// Bayar hutang per faktur. Jurnal: Dr 2101 / Cr rekening kas/bank yang dipilih.
export async function bayarFaktur(formData: FormData) {
  const supabase = await createClient();
  const back = "/keuangan/hutang";

  const invoiceId = String(formData.get("invoice_id") ?? "");
  const amount = Number(formData.get("amount")) || 0;
  const metode = String(formData.get("metode") ?? "Transfer");
  const tanggal = String(formData.get("tanggal") ?? "") || hariIniWIB();
  const catatan = String(formData.get("catatan") ?? "").trim() || null;
  const accountId = String(formData.get("account_id") ?? "").trim() || null;

  const fail = (msg: string) => redirect(`${back}?error=${encodeURIComponent(msg)}`);
  if (!invoiceId || amount <= 0) fail("Nominal pembayaran tidak valid.");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) fail(pesanPeriode);

  const { data: inv } = await supabase
    .from("purchase_invoices")
    .select("id, no_faktur, total, po_id, supplier_id, branch_id, purchase_orders(branch_id)")
    .eq("id", invoiceId).maybeSingle();
  if (!inv) fail("Faktur tidak ditemukan.");

  const { data: pays } = await supabase
    .from("purchase_invoice_payments").select("amount").eq("invoice_id", invoiceId);
  const dibayar = (pays ?? []).reduce((a, p) => a + Number(p.amount), 0);
  const sisa = Math.max(0, Number(inv!.total) - dibayar);
  if (sisa <= 0) fail("Faktur ini sudah lunas.");
  if (amount > sisa) fail(`Nominal melebihi sisa faktur (maks Rp ${Math.round(sisa).toLocaleString("id-ID")}).`);

  // Uang muka yang dipilih dipotongkan lebih dulu — uangnya sudah keluar waktu DP
  // dibayar, jadi porsi itu tidak boleh keluar lagi dari kas.
  const advanceId = String(formData.get("advance_id") ?? "").trim() || null;
  let dariUangMuka = 0;
  type Advance = { id: string; jumlah: number; terpakai: number; supplier_id: string | null; status: string };
  let advance: Advance | null = null;

  if (advanceId) {
    const { data: um } = await supabase
      .from("purchase_advances").select("id, jumlah, terpakai, supplier_id, status").eq("id", advanceId).maybeSingle();
    if (!um) fail("Uang muka tidak ditemukan.");
    if (um!.status !== "aktif") fail("Uang muka itu sudah dibatalkan.");
    if (um!.supplier_id && inv!.supplier_id && um!.supplier_id !== inv!.supplier_id) {
      fail("Uang muka itu milik pemasok lain.");
    }
    advance = um as Advance;
    dariUangMuka = pakaiUangMuka(Number(um!.jumlah) - Number(um!.terpakai), amount);
    if (dariUangMuka <= 0) fail("Uang muka itu sudah habis terpakai.");
  }

  const { data: { user } } = await supabase.auth.getUser();

  // Persetujuan diperiksa TEPAT DI SINI: setelah semua validasi lolos, sebelum
  // satu rupiah pun tercatat keluar. Kalau ditahan, tidak ada baris pembayaran,
  // tidak ada jurnal, dan tidak ada uang muka yang terpakai.
  const izin = await cekPersetujuan(supabase, {
    jenis: "bayar-faktur",
    refId: invoiceId,
    nilai: amount,
    noDokumen: inv!.no_faktur,
    keterangan: `Pembayaran faktur ${inv!.no_faktur} sebesar Rp ${Math.round(amount).toLocaleString("id-ID")}`,
    userId: user?.id ?? null,
  });
  if (!izin.boleh) fail(izin.pesan ?? "Transaksi ini butuh persetujuan atasan.");

  const { error: payErr } = await supabase.from("purchase_invoice_payments").insert({
    invoice_id: invoiceId, tanggal, amount, metode, catatan, created_by: user?.id ?? null,
    advance_id: advance?.id ?? null, dari_uang_muka: dariUangMuka,
  });
  if (payErr) fail(payErr.message);

  if (advance) {
    await supabase.from("purchase_advances")
      .update({ terpakai: Number(advance.terpakai) + dariUangMuka }).eq("id", advance.id);
  }

  // Faktur langsung tidak punya PO, jadi cabangnya disimpan di fakturnya sendiri.
  const po = inv!.purchase_orders as unknown as { branch_id: string | null } | null;
  const cabang = (inv as { branch_id?: string | null }).branch_id ?? po?.branch_id ?? null;
  const kasCode = await kodeAkunBayar(supabase, metode, cabang, accountId);
  await postJournal(supabase, {
    tanggal,
    deskripsi: dariUangMuka > 0
      ? `Pembayaran faktur ${inv!.no_faktur} (pakai uang muka)`
      : `Pembayaran faktur ${inv!.no_faktur}`,
    source: "purchase-pay",
    sourceRef: inv!.no_faktur,
    branchId: cabang,
    lines: jurnalBayarHutang(kasCode, amount, dariUangMuka),
  });

  revalidatePath(back);
  redirect(`${back}?success=${encodeURIComponent(`Pembayaran ${inv!.no_faktur} tersimpan.`)}`);
}
