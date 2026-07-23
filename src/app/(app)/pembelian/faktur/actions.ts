"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { buildFakturLines, formatNoFaktur, sisaFakturable } from "@/lib/faktur-beli";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { totalRetur } from "@/lib/retur";

type ItemInput = { item_id: string; qty: number; harga: number };

type Db = Awaited<ReturnType<typeof createClient>>;

// ponytail: nomor via count bulan berjalan +1 — pola existing (pemindahan/retur).
async function nextNoFaktur(supabase: Db) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { count } = await supabase
    .from("purchase_invoices").select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString());
  return formatNoFaktur(now, (count ?? 0) + 1);
}

// Buat Faktur Pembelian dari PO Diterima. Harga/qty boleh beda dari PO (faktur pemasok).
// Jurnal: Dr 2102 (nilai PO porsi difakturkan) / Cr 2101 (nilai faktur); selisih -> 1301.
export async function buatFaktur(formData: FormData) {
  const supabase = await createClient();

  const po_id = String(formData.get("po_id") ?? "");
  const no_faktur_pemasok = String(formData.get("no_faktur_pemasok") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "") || new Date().toISOString().slice(0, 10);
  const jatuh_tempo = String(formData.get("jatuh_tempo") ?? "") || tanggal;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  let items: ItemInput[] = [];
  try { items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[]; } catch { items = []; }
  items = items.filter((it) => it.item_id && Number(it.qty) > 0);

  const fail = (msg: string) => redirect("/pembelian/faktur/baru?error=" + encodeURIComponent(msg));

  if (!po_id || items.length === 0) fail("Pilih PO dan minimal 1 barang.");

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, no_po, status, supplier_id, branch_id, purchase_order_items(item_id, qty, harga_beli)")
    .eq("id", po_id).single();
  if (!po) fail("PO tidak ditemukan.");
  if (po!.status !== "Diterima") fail("Hanya PO berstatus Diterima yang bisa difakturkan.");

  // qty PO & harga PO per item
  const qtyPO: Record<string, number> = {};
  const hargaPO: Record<string, number> = {};
  for (const r of po!.purchase_order_items ?? []) {
    if (!r.item_id) continue;
    qtyPO[r.item_id] = (qtyPO[r.item_id] ?? 0) + Number(r.qty);
    hargaPO[r.item_id] = Number(r.harga_beli) || 0;
  }

  // akumulasi qty yang sudah difakturkan (multi-faktur per PO)
  const { data: prev } = await supabase
    .from("purchase_invoices").select("purchase_invoice_items(item_id, qty)").eq("po_id", po_id);
  const sudah: Record<string, number> = {};
  for (const d of prev ?? [])
    for (const r of d.purchase_invoice_items ?? [])
      if (r.item_id) sudah[r.item_id] = (sudah[r.item_id] ?? 0) + Number(r.qty);

  const sisa = sisaFakturable(qtyPO, sudah);
  for (const it of items) {
    if ((sisa[it.item_id] ?? 0) < Number(it.qty))
      fail(`Qty faktur melebihi sisa PO yang bisa difakturkan (sisa ${sisa[it.item_id] ?? 0}).`);
  }

  const rows = items.map((it) => ({ item_id: it.item_id, qty: Number(it.qty), harga: Number(it.harga) || 0 }));
  const total = totalRetur(rows); // Σ qty × harga (fungsi generik)
  const nilaiPOFakturkan = rows.reduce((a, r) => a + r.qty * (hargaPO[r.item_id] ?? 0), 0);
  if (total <= 0) fail("Nilai faktur nol.");

  const { data: { user } } = await supabase.auth.getUser();
  const no_faktur = await nextNoFaktur(supabase);

  const { data: itemNames } = await supabase
    .from("items").select("id, name").in("id", rows.map((r) => r.item_id));
  const nameMap = new Map((itemNames ?? []).map((r) => [r.id, r.name]));

  const { data: doc, error } = await supabase
    .from("purchase_invoices")
    .insert({
      no_faktur, no_faktur_pemasok, po_id, supplier_id: po!.supplier_id ?? null,
      tanggal, jatuh_tempo, total, keterangan, created_by: user?.id ?? null,
    })
    .select("id").single();
  if (error || !doc) fail("Gagal menyimpan faktur.");

  const { error: itemsErr } = await supabase.from("purchase_invoice_items").insert(
    rows.map((r) => ({
      invoice_id: doc!.id, item_id: r.item_id,
      nama: (nameMap.get(r.item_id) ?? "").slice(0, 160) || "—",
      qty: r.qty, harga: r.harga,
    })),
  );
  if (itemsErr) {
    console.error("faktur beli: gagal insert rincian", itemsErr);
    await supabase.from("purchase_invoices").delete().eq("id", doc!.id);
    fail("Gagal menyimpan rincian faktur.");
  }

  // Mode PKP: total faktur dianggap inklusif PPN → pisahkan PPN Masukan (Dr 1105).
  const { ppn } = splitPpnInklusif(total, await getPajakSettings(supabase));
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Faktur pembelian ${no_faktur} (${po!.no_po ?? po_id})`,
    source: "purchase-invoice",
    sourceRef: no_faktur,
    branchId: po!.branch_id ?? null,
    lines: buildFakturLines(nilaiPOFakturkan, total, ppn),
  });

  revalidatePath("/pembelian/faktur");
  revalidatePath("/keuangan/hutang");
  redirect("/pembelian/faktur?success=" + encodeURIComponent(`Faktur ${no_faktur} tersimpan.`));
}

// Bayar hutang per faktur. Jurnal: Dr 2101 / Cr Kas(1101)/Bank(1102).
export async function bayarFaktur(formData: FormData) {
  const supabase = await createClient();
  const back = "/keuangan/hutang";

  const invoiceId = String(formData.get("invoice_id") ?? "");
  const amount = Number(formData.get("amount")) || 0;
  const metode = String(formData.get("metode") ?? "Transfer");
  const tanggal = String(formData.get("tanggal") ?? "") || new Date().toISOString().slice(0, 10);
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  const fail = (msg: string) => redirect(`${back}?error=${encodeURIComponent(msg)}`);
  if (!invoiceId || amount <= 0) fail("Nominal pembayaran tidak valid.");

  const { data: inv } = await supabase
    .from("purchase_invoices")
    .select("id, no_faktur, total, po_id, purchase_orders(branch_id)")
    .eq("id", invoiceId).maybeSingle();
  if (!inv) fail("Faktur tidak ditemukan.");

  const { data: pays } = await supabase
    .from("purchase_invoice_payments").select("amount").eq("invoice_id", invoiceId);
  const dibayar = (pays ?? []).reduce((a, p) => a + Number(p.amount), 0);
  const sisa = Math.max(0, Number(inv!.total) - dibayar);
  if (sisa <= 0) fail("Faktur ini sudah lunas.");
  if (amount > sisa) fail(`Nominal melebihi sisa faktur (maks Rp ${Math.round(sisa).toLocaleString("id-ID")}).`);

  const { data: { user } } = await supabase.auth.getUser();
  const { error: payErr } = await supabase.from("purchase_invoice_payments").insert({
    invoice_id: invoiceId, tanggal, amount, metode, catatan, created_by: user?.id ?? null,
  });
  if (payErr) fail(payErr.message);

  const po = inv!.purchase_orders as unknown as { branch_id: string | null } | null;
  const kasCode = metode === "Tunai" ? "1101" : "1102";
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Pembayaran faktur ${inv!.no_faktur}`,
    source: "purchase-pay",
    sourceRef: inv!.no_faktur,
    branchId: po?.branch_id ?? null,
    lines: [
      { code: "2101", debit: amount, credit: 0 },
      { code: kasCode, debit: 0, credit: amount },
    ],
  });

  revalidatePath(back);
  redirect(`${back}?success=${encodeURIComponent(`Pembayaran ${inv!.no_faktur} tersimpan.`)}`);
}
