"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { buildFakturLines, formatNoFaktur, sisaFakturable } from "@/lib/faktur-beli";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { qtyDiterima } from "@/lib/penerimaan";
import { totalRetur } from "@/lib/retur";
import { jurnalBayarHutang, pakaiUangMuka } from "@/lib/uang-muka";
import { prefixBulanan, urutanBerikutnya, ymDari } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";

type ItemInput = { item_id: string; qty: number; harga: number };

type Db = Awaited<ReturnType<typeof createClient>>;

// ponytail: nomor via count bulan berjalan +1 — pola existing (pemindahan/retur).
async function nextNoFaktur(supabase: Db) {
  const now = new Date();
  const seq = await urutanBerikutnya(supabase, {
    table: "purchase_invoices", column: "no_faktur",
    prefix: prefixBulanan("FB", ymDari(now)), pad: 5,
  });
  return formatNoFaktur(now, seq);
}

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
  try { items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[]; } catch { items = []; }
  items = items.filter((it) => it.item_id && Number(it.qty) > 0);

  const fail = (msg: string) => redirect("/pembelian/faktur/baru?error=" + encodeURIComponent(msg));

  if (!po_id || items.length === 0) fail("Pilih PO dan minimal 1 barang.");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) fail(pesanPeriode);

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, no_po, status, supplier_id, branch_id, purchase_order_items(item_id, qty, qty_terima, harga_beli)")
    .eq("id", po_id).single();
  if (!po) fail("PO tidak ditemukan.");
  if (po!.status !== "Diterima") fail("Hanya PO berstatus Diterima yang bisa difakturkan.");

  // qty diterima (bukan qty pesanan) & harga PO per item
  const qtyPO: Record<string, number> = {};
  const hargaPO: Record<string, number> = {};
  for (const r of po!.purchase_order_items ?? []) {
    if (!r.item_id) continue;
    qtyPO[r.item_id] = (qtyPO[r.item_id] ?? 0) + qtyDiterima(r);
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

  // Gudang PO dipakai menyaring lapisan yang boleh disesuaikan harganya.
  const { data: whPO } = await supabase
    .from("warehouses").select("id").eq("branch_id", po!.branch_id ?? "")
    .eq("is_active", true).order("code").limit(1).maybeSingle();
  const gudangPO = whPO?.id as string | undefined;

  // Selisih harga faktur vs PO tidak cuma dijurnal ke 1301 — modal barangnya
  // ikut disesuaikan. Kalau tidak, nilai persediaan di buku besar dan nilai stok
  // riil pelan-pelan berpisah, dan HPP penjualan berikutnya memakai harga PO
  // yang sudah tidak berlaku.
  //
  // Hanya lapisan yang MASIH ADA sisanya yang disesuaikan: barang yang telanjur
  // terjual sebelum faktur datang sudah dibebankan dengan harga lama, dan
  // mengubahnya berarti mengubah HPP transaksi yang sudah dibukukan.
  for (const r of rows) {
    const hargaPo = hargaPO[r.item_id] ?? 0;
    if (hargaPo <= 0 || r.harga === hargaPo) continue;
    // Gudangnya ikut disaring: tanpa itu, faktur PO cabang A bisa me-repricing
    // lapisan cabang B yang kebetulan berharga sama.
    let q = supabase
      .from("stock_layers").select("id, qty_left")
      .eq("item_id", r.item_id).eq("unit_cost", hargaPo).eq("source", "purchase")
      .gt("qty_left", 0);
    if (gudangPO) q = q.eq("warehouse_id", gudangPO);
    const { data: layers } = await q.order("tanggal").order("created_at");
    let sisaSesuaikan = r.qty;
    for (const l of layers ?? []) {
      if (sisaSesuaikan <= 0) break;
      await supabase.from("stock_layers").update({ unit_cost: r.harga }).eq("id", l.id);
      sisaSesuaikan -= Number(l.qty_left);
    }
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
