"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { stockOut } from "@/lib/inventory";
import { recomputeCustomerTier } from "@/lib/customer-tier";
import {
  formatNoOnline,
  hitungKomisi,
  isChannel,
  isMarketplace,
  prefixNoOnline,
  totalOnline,
} from "@/lib/online";

const BACK = "/penjualan/online";
const POIN_PER_RUPIAH = 1000; // earn: 1 poin / Rp1.000 (sama dengan POS)

type ItemInput = { item_id: string; nama: string; qty: number; harga: number };

// Order online: TANPA shift kasir (shift_id null) — settlement bukan tunai fisik.
// Marketplace → Dr 1202 Piutang Marketplace; WA → Dr 1102 Bank (lunas seketika).
export async function buatPenjualanOnline(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const fail = (msg: string) => redirect(`${BACK}/baru?error=${encodeURIComponent(msg)}`);

  const channel = String(formData.get("channel") ?? "");
  if (!isChannel(channel)) fail("Pilih channel penjualan yang valid.");

  const warehouseId = String(formData.get("warehouse_id") ?? "");
  if (!warehouseId) fail("Pilih gudang online.");

  const buyerName = String(formData.get("buyer_name") ?? "").trim() || null;
  const externalRef = String(formData.get("external_ref") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "") || new Date().toISOString().slice(0, 10);
  // Marketplace tidak masuk CRM/poin (keputusan spec); hanya WA yang boleh link pelanggan.
  const customerId = channel === "WA" ? (String(formData.get("customer_id") ?? "") || null) : null;

  let items: ItemInput[] = [];
  try { items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[]; } catch { items = []; }
  items = items.filter((it) => it.item_id && Number(it.qty) > 0);
  if (items.length === 0) fail("Minimal 1 barang.");

  // Gudang online menentukan cabang (sales.branch_id NOT NULL).
  const { data: wh } = await supabase
    .from("warehouses").select("id, branch_id")
    .eq("id", warehouseId).eq("type", "ONLINE").eq("is_active", true).maybeSingle();
  if (!wh) fail("Gudang online tidak ditemukan atau tidak aktif.");
  const branchId = wh!.branch_id;

  const total = totalOnline(items);
  if (total <= 0) fail("Total order harus lebih dari nol.");

  const d = new Date(tanggal + "T00:00:00");
  const { count } = await supabase
    .from("sales").select("*", { count: "exact", head: true })
    .like("no_struk", `${prefixNoOnline(d)}-%`);
  const noStruk = formatNoOnline(d, (count ?? 0) + 1);

  const marketplace = isMarketplace(channel);
  const poinEarned = customerId ? Math.floor(total / POIN_PER_RUPIAH) : 0;

  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .insert({
      branch_id: branchId, customer_id: customerId, no_struk: noStruk,
      subtotal: total, discount: 0, total,
      metode_bayar: channel, bayar: total, kembali: 0,
      poin_earned: poinEarned, cashier_id: user?.id ?? null,
      channel, external_ref: externalRef, buyer_name: buyerName,
      marketplace_status: marketplace ? "piutang" : null,
      created_at: `${tanggal}T00:00:00Z`,
    })
    .select("id").single();
  if (saleErr || !sale) fail(saleErr?.message ?? "Gagal simpan order online.");

  const { error: itErr } = await supabase.from("sale_items").insert(
    items.map((l) => ({
      sale_id: sale!.id, item_id: l.item_id, nama: l.nama, qty: l.qty, harga: l.harga,
    })),
  );
  if (itErr) fail(itErr.message);

  // Stok gudang online berkurang lewat FIFO — cost jadi HPP riil (PRD §10.2).
  let hppFifo = 0;
  for (const l of items) {
    const { cost } = await stockOut(supabase, {
      warehouseId, itemId: l.item_id, qty: l.qty, source: "sale-online", ref: noStruk,
    });
    hppFifo += cost;
  }

  // Poin & tier hanya untuk order WA yang dilink ke pelanggan.
  if (customerId && poinEarned > 0) {
    const { data: cust } = await supabase
      .from("customers").select("points").eq("id", customerId).maybeSingle();
    const saldo = (cust?.points ?? 0) + poinEarned;
    await supabase.from("point_ledger").insert({
      customer_id: customerId, delta: poinEarned, saldo, ref: noStruk,
      description: `Penjualan online ${noStruk}`,
    });
    await supabase.from("customers").update({ points: saldo }).eq("id", customerId);
    await recomputeCustomerTier(supabase, customerId);
  }

  // Jurnal pendapatan. Marketplace ditahan platform → piutang; WA langsung ke bank.
  const debitCode = marketplace ? "1202" : "1102";
  const { dpp, ppn } = splitPpnInklusif(total, await getPajakSettings(supabase));
  await postJournal(supabase, {
    tanggal, deskripsi: `Penjualan online ${channel} ${noStruk}`,
    source: "sale-online", sourceRef: noStruk, branchId,
    lines: [
      { code: debitCode, debit: total, credit: 0 },
      { code: "4101", debit: 0, credit: dpp },
      ...(ppn > 0 ? [{ code: "2201", debit: 0, credit: ppn }] : []),
    ],
  });

  // HPP = cost FIFO riil dari layer yang terkonsumsi.
  if (hppFifo > 0) {
    await postJournal(supabase, {
      tanggal, deskripsi: `HPP penjualan online ${noStruk}`,
      source: "sale-online-hpp", sourceRef: noStruk, branchId,
      lines: [
        { code: "5101", debit: hppFifo, credit: 0 },
        { code: "1301", debit: 0, credit: hppFifo },
      ],
    });
  }

  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent(`Order ${noStruk} tersimpan.`)}`);
}

// Pencairan marketplace: input dana yang benar-benar masuk bank; selisihnya = komisi platform.
// ponytail: 1 order = 1 pencairan. Kalau volume naik dan platform mencairkan
// banyak order sekaligus, naikkan ke pencairan batch (tabel disbursements).
export async function tandaiCair(formData: FormData) {
  const supabase = await createClient();
  const fail = (msg: string) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

  const saleId = String(formData.get("sale_id") ?? "");
  const nominal = Number(formData.get("nominal")) || 0;
  if (!saleId) fail("Order tidak dikenali.");
  if (nominal <= 0) fail("Nominal pencairan harus lebih dari nol.");

  const { data: sale } = await supabase
    .from("sales")
    .select("id, no_struk, total, channel, marketplace_status, branch_id")
    .eq("id", saleId).maybeSingle();
  if (!sale) fail("Order tidak ditemukan.");
  if (!sale!.channel || !isMarketplace(sale!.channel)) fail("Order ini bukan order marketplace.");
  if (sale!.marketplace_status !== "piutang") fail("Order ini sudah dicairkan.");

  const total = Number(sale!.total);
  const komisi = hitungKomisi(total, nominal);
  const now = new Date();
  const tanggal = now.toISOString().slice(0, 10);

  const { error: updErr } = await supabase
    .from("sales")
    .update({ marketplace_status: "cair", komisi, disbursed_at: now.toISOString() })
    .eq("id", saleId);
  if (updErr) fail(updErr.message);

  // Dr Bank (dana masuk) + Dr Beban Komisi (potongan platform) / Cr Piutang Marketplace (nilai order).
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Pencairan ${sale!.channel} ${sale!.no_struk}`,
    source: "sale-online-cair", sourceRef: sale!.no_struk, branchId: sale!.branch_id,
    lines: [
      { code: "1102", debit: Math.min(nominal, total), credit: 0 },
      ...(komisi > 0 ? [{ code: "5305", debit: komisi, credit: 0 }] : []),
      { code: "1202", debit: 0, credit: total },
    ],
  });

  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent(`Pencairan ${sale!.no_struk} tercatat.`)}`);
}
