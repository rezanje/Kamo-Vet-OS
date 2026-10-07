"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {transactionDraftAck} from "@/lib/transaction-draft-ack";
import { rencanakanRepriceLapisan, sisaFakturablePerBaris, type ItemFakturPoTersimpan, type LapisanStokFaktur, type PoItemUntukFaktur } from "@/lib/faktur-beli";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { totalRetur } from "@/lib/retur";
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
  const requestKey = String(formData.get("request_key") ?? "").trim();
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

  if (!requestKey || !po_id || items.length === 0) fail("Pilih PO dan minimal 1 barang.");
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

  // Recover before remaining-quantity checks or rebuilding a now-stale FIFO plan.
  const payload = {
    po_id, tanggal, jatuh_tempo, no_faktur_pemasok, keterangan,
    items: items.map((r) => ({ po_item_id: r.po_item_id, qty: Number(r.qty), harga: Number(r.harga) }))
      .sort((a, b) => a.po_item_id.localeCompare(b.po_item_id)),
  };
  const finish = (noFaktur: string): never => {
    revalidatePath("/pembelian/faktur");
    revalidatePath("/keuangan/hutang");
    redirect(`/pembelian/faktur?success=${encodeURIComponent(`Faktur ${noFaktur} tersimpan.`)}&request_done=${encodeURIComponent(requestKey)}&request_scope=invoice`);
  };
  const { data: recovered, error: recoveryError } = await supabase.rpc("recover_purchase_operation", {
    p_kind: "invoice", p_request_key: requestKey, p_payload: payload,
  });
  if (recoveryError) fail(recoveryError.message);
  if (recovered?.no_faktur) finish(recovered.no_faktur);

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
    p_request_key: requestKey,
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
    fail("Faktur belum terkonfirmasi. Periksa hasil transaksi terakhir atau coba lagi dengan formulir yang sama.");
  }
  const created = Array.isArray(result) ? result[0] : result;
  if (!created?.no_faktur) fail("Faktur belum terkonfirmasi. Periksa hasil transaksi terakhir.");

  finish(created.no_faktur);
}

// Bayar hutang per faktur; invoice/PO/advance/payment/journal share one database transaction.
export async function bayarFaktur(formData: FormData) {
  const supabase=await createClient();const back="/keuangan/hutang";
  const invoiceId=String(formData.get("invoice_id")??"");
  const requestKey=String(formData.get("draft_key")??"");
  const amount=Number(formData.get("amount"));
  const metode=String(formData.get("metode")??"Transfer");
  const tanggal=String(formData.get("tanggal")??"")||hariIniWIB();
  const catatan=String(formData.get("catatan")??"").trim()||null;
  const accountId=String(formData.get("account_id")??"").trim()||null;
  const advanceId=String(formData.get("advance_id")??"").trim()||null;
  const fail=(message:string):never=>redirect(`${back}?error=${encodeURIComponent(message)}`);
  if(!invoiceId||!requestKey||!Number.isFinite(amount)||amount<=0)fail("Nominal atau identitas pembayaran tidak valid. Muat ulang formulir.");
  if(!Number.isInteger(amount))fail("Nominal pembayaran harus dalam rupiah bulat.");
  const payload={invoice_id:invoiceId,tanggal,amount,metode,catatan,account_id:accountId,advance_id:advanceId};
  const finish=(noFaktur:string):never=>{revalidatePath(back);redirect(`${back}?success=${encodeURIComponent(`Pembayaran ${noFaktur} tersimpan.`)}${transactionDraftAck(formData)}`);};
  const {data:recovered,error:recoveryError}=await supabase.rpc("recover_purchase_payment",{p_request_key:requestKey,p_payload:payload});
  if(recoveryError)fail(recoveryError.message);
  if(recovered?.no_faktur)finish(recovered.no_faktur);
  const pesanPeriode=await cekPeriode(supabase,tanggal);if(pesanPeriode)fail(pesanPeriode);
  const {data:inv,error:invoiceError}=await supabase.from("purchase_invoices").select("id,no_faktur").eq("id",invoiceId).maybeSingle();
  if(invoiceError||!inv)fail("Faktur tidak ditemukan.");
  const {data:{user}}=await supabase.auth.getUser();
  const izin=await cekPersetujuan(supabase,{jenis:"bayar-faktur",refId:invoiceId,nilai:amount,noDokumen:inv!.no_faktur,keterangan:`Pembayaran faktur ${inv!.no_faktur} sebesar Rp ${Math.round(amount).toLocaleString("id-ID")}`,userId:user?.id??null,deferConsumption:true});
  if(!izin.boleh)fail(izin.pesan??"Transaksi ini butuh persetujuan atasan.");
  const {data:result,error}=await supabase.rpc("pay_purchase_invoice_atomic",{p_request_key:requestKey,p_invoice_id:invoiceId,p_tanggal:tanggal,p_amount:amount,p_metode:metode,p_catatan:catatan,p_account_id:accountId,p_advance_id:advanceId});
  if(error)fail(error.message);
  if(!result?.payment_id||!result?.journal_id||!result?.no_faktur)throw new Error("Pembayaran belum terkonfirmasi lengkap. Periksa transaksi sebelum menyimpan ulang.");
  finish(result.no_faktur);
}
