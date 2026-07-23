"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { stockOut } from "@/lib/inventory";
import { computeTotals, lineDiscount } from "@/lib/pos-calc";
import { processQuestProgress } from "@/lib/quest-hook";
import { recomputeCustomerTier } from "@/lib/customer-tier";

type CartLine = {
  item_id: string; nama: string; qty: number; harga: number; target_species?: string;
  item_discount_type?: "nominal" | "percent" | null; item_discount_value?: number | null;
};

const POIN_PER_RUPIAH = 1000; // earn: 1 poin / Rp1.000
const RUPIAH_PER_POIN = 1;    // redeem: 1 poin = Rp1

export async function checkoutKasir(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // shift & cabang dari server (jangan percaya client).
  const { data: shift } = await supabase
    .from("cashier_shifts").select("id, branch_id")
    .eq("opened_by", user?.id ?? "").eq("status", "open").eq("shift_type", "petshop").maybeSingle();
  if (!shift) redirect("/kasir/mulai");

  const branchId = shift!.branch_id;
  const customerId = String(formData.get("customerId") ?? "") || null;
  if (!customerId) redirect(`/kasir?error=${encodeURIComponent("Pilih pelanggan dulu sebelum bayar")}`);
  const metode = String(formData.get("metode") ?? "");
  if (!metode) redirect(`/kasir?error=${encodeURIComponent("Pilih metode pembayaran dulu")}`);
  const diskon = Math.max(0, Number(formData.get("diskon")) || 0);
  const voucherCode = String(formData.get("voucherCode") ?? "").trim().toUpperCase() || null;
  const poinReq = Math.max(0, Math.floor(Number(formData.get("poinDigunakan")) || 0));
  const bayar = Number(formData.get("bayar")) || 0;

  let cart: CartLine[] = [];
  try {
    cart = JSON.parse(String(formData.get("cart") ?? "[]"));
  } catch {
    cart = [];
  }
  const rows = cart.filter((l) => l.nama?.trim() && Number(l.qty) > 0);
  if (rows.length === 0) redirect(`/kasir?error=${encodeURIComponent("Keranjang kosong")}`);

  // Urutan kalkulasi (§6): diskon item → diskon transaksi + voucher → poin (lib/pos-calc — jangan diubah).
  const subtotal = rows.reduce((a, l) => a + l.qty * l.harga, 0);
  const afterItems = subtotal - rows.reduce((a, l) => a + lineDiscount(l), 0);

  // voucher divalidasi server-side (persen dihitung setelah diskon item).
  let voucherVal = 0;
  if (voucherCode) {
    const { data: v } = await supabase.from("vouchers").select("tipe, nilai").eq("code", voucherCode).eq("is_active", true).maybeSingle();
    if (!v) redirect(`/kasir?error=${encodeURIComponent("Kode voucher tidak valid")}`);
    voucherVal = v!.tipe === "persen" ? Math.round((afterItems * Number(v!.nilai)) / 100) : Number(v!.nilai);
  }

  // poin divalidasi terhadap saldo pelanggan sebenarnya.
  let poinDigunakan = 0;
  let custPoints = 0;
  if (customerId) {
    const { data: cust } = await supabase.from("customers").select("points, total_spending").eq("id", customerId).single();
    custPoints = cust?.points ?? 0;
    poinDigunakan = Math.min(poinReq, custPoints);
  } else if (poinReq > 0) {
    redirect(`/kasir?error=${encodeURIComponent("Pilih pelanggan dulu untuk pakai poin")}`);
  }

  const potonganPoin = poinDigunakan * RUPIAH_PER_POIN;
  const totals = computeTotals(rows, diskon, voucherVal, potonganPoin);
  poinDigunakan = totals.poin; // poin efektif setelah cap (tidak melebihi sisa tagihan)
  const totalDiskon = totals.itemDiscountTotal + totals.txnLevel + totals.poin;
  const total = totals.total;
  const kembali = metode === "Tunai" ? Math.max(0, bayar - total) : 0;
  if (metode === "Tunai" && bayar < total) redirect(`/kasir?error=${encodeURIComponent("Uang bayar kurang")}`);

  const now = new Date();
  const prefix = `POS-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const { count } = await supabase.from("sales").select("*", { count: "exact", head: true }).like("no_struk", `${prefix}-%`);
  const noStruk = `${prefix}-${String((count ?? 0) + 1).padStart(4, "0")}`;

  const poinEarned = customerId ? Math.floor(total / POIN_PER_RUPIAH) : 0;

  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .insert({
      branch_id: branchId, customer_id: customerId, no_struk: noStruk,
      subtotal, discount: totalDiskon, total, metode_bayar: metode, bayar: metode === "Tunai" ? bayar : total,
      kembali, poin_earned: poinEarned, poin_digunakan: poinDigunakan, voucher_code: voucherCode,
      cashier_id: user?.id ?? null, shift_id: shift!.id,
    })
    .select("id").single();
  if (saleErr || !sale) redirect(`/kasir?error=${encodeURIComponent(saleErr?.message ?? "Gagal simpan transaksi")}`);

  const { error: itErr } = await supabase.from("sale_items").insert(
    rows.map((l) => ({
      sale_id: sale!.id, item_id: l.item_id, nama: l.nama, qty: l.qty, harga: l.harga,
      target_species: l.target_species ?? "Universal",
      item_discount_type: l.item_discount_type ?? null,
      item_discount_value: Math.max(0, Number(l.item_discount_value) || 0),
    }))
  );
  if (itErr) redirect(`/kasir?error=${encodeURIComponent(itErr.message)}`);

  // stok toko berkurang — via FIFO; total cost jadi HPP riil (PRD §10.2).
  let hppFifo = 0;
  const { data: wh } = await supabase
    .from("warehouses").select("id").eq("branch_id", branchId).eq("is_active", true).order("type").limit(1).maybeSingle();
  if (wh) {
    for (const r of rows) {
      if (!r.item_id) continue;
      const { cost } = await stockOut(supabase, {
        warehouseId: wh.id, itemId: r.item_id, qty: r.qty, source: "sale", ref: noStruk,
      });
      hppFifo += cost;
    }
  }

  // poin: redeem (minus) lalu earn (plus), saldo berjalan konsisten di ledger.
  if (customerId) {
    let saldo = custPoints;
    if (poinDigunakan > 0) {
      saldo -= poinDigunakan;
      await supabase.from("point_ledger").insert({ customer_id: customerId, delta: -poinDigunakan, saldo, ref: noStruk, description: `Poin digunakan ${noStruk}` });
    }
    if (poinEarned > 0) {
      saldo += poinEarned;
      await supabase.from("point_ledger").insert({ customer_id: customerId, delta: poinEarned, saldo, ref: noStruk, description: `Transaksi ${noStruk}` });
    }
    await supabase.from("customers").update({ points: saldo }).eq("id", customerId);
    await recomputeCustomerTier(supabase, customerId);
  }

  // Jurnal: pendapatan (PPN-inklusif, dipisah) + HPP. Total sudah net semua potongan.
  const kasCode = metode === "Tunai" ? "1101" : "1102";
  const { dpp, ppn } = splitPpnInklusif(total, await getPajakSettings(supabase));
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (total > 0) {
    await postJournal(supabase, {
      tanggal: todayIso, deskripsi: `Penjualan POS ${noStruk}`, source: "sale", sourceRef: noStruk, branchId,
      lines: [
        { code: kasCode, debit: total, credit: 0 },
        { code: "4101", debit: 0, credit: dpp },
        ...(ppn > 0 ? [{ code: "2201", debit: 0, credit: ppn }] : []),
      ],
    });
  }
  // HPP = cost FIFO riil dari layer yang terkonsumsi (bukan buy_price statis).
  if (hppFifo > 0) {
    await postJournal(supabase, {
      tanggal: todayIso, deskripsi: `HPP penjualan ${noStruk}`, source: "sale-hpp", sourceRef: noStruk, branchId,
      lines: [
        { code: "5101", debit: hppFifo, credit: 0 },
        { code: "1301", debit: 0, credit: hppFifo },
      ],
    });
  }

  // Addendum §8: progres quest staff (best-effort, tidak mem-block checkout).
  if (user?.id) {
    await processQuestProgress(supabase, {
      staffId: user.id, branchId, saleTotal: total,
      lines: rows.map((r) => ({ item_id: r.item_id || null, qty: r.qty })),
    });
  }

  // Auto-cetak struk (fire window.print di halaman struk) — semua metode bayar.
  redirect(`/kasir/struk/${sale!.id}?print=1`);
}
