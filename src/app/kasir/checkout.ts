"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { stockOut } from "@/lib/inventory";
import { loadHargaCabang, hargaCabang } from "@/lib/harga-cabang";
import { computeTotals, lineDiscount } from "@/lib/pos-calc";
import { processQuestProgress } from "@/lib/quest-hook";
import { recomputeCustomerTier } from "@/lib/customer-tier";
import { pesanVoucherDitolak, potonganVoucher, normalizeKode, type VoucherRow } from "@/lib/voucher";
import {
  diskonGolonganKeranjang, loadAturanDiskon, loadInfoBarang, poinDidapat,
} from "@/lib/harga-golongan";
import { hitungPromoKeranjang, loadPromoAktif } from "@/lib/promo-hitung";
import { formatNomor, urutanBerikutnya } from "@/lib/no-dokumen";

type CartLine = {
  item_id: string; nama: string; qty: number; harga: number; target_species?: string;
  item_discount_type?: "nominal" | "percent" | null; item_discount_value?: number | null;
  promo_discount?: number | null;   // diisi server dari master, bukan dari klien
};

// Earning sekarang ikut golongan pelanggan (lib/harga-golongan → poinDidapat).
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
  // normalizeKode = aturan yang sama dengan layar pengelola voucher, jadi kode
  // yang diketik pakai spasi ("HEMAT 10") tetap ketemu barisnya.
  const voucherCode = normalizeKode(formData.get("voucherCode")) || null;
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

  // Harga ditetapkan ULANG di server: harga jual sekarang bisa beda per cabang
  // (migrasi 0073), jadi layar kasir yang sudah lama terbuka tidak boleh menentukan
  // harga sendiri. Baris tanpa item_id (ketikan manual) tetap pakai harga yang diisi.
  const cartIds = [...new Set(rows.map((l) => l.item_id).filter(Boolean))];
  if (cartIds.length > 0) {
    const [{ data: itemsHarga }, hargaMap] = await Promise.all([
      supabase.from("items").select("id, nama:name, unit, sell_price, min_sell_qty").in("id", cartIds),
      loadHargaCabang(supabase, branchId, cartIds),
    ]);
    const pusat = new Map(
      ((itemsHarga ?? []) as { id: string; nama: string; unit: string; sell_price: number; min_sell_qty: number }[])
        .map((i) => [i.id, i]),
    );
    for (const l of rows) {
      const p = l.item_id ? pusat.get(l.item_id) : undefined;
      if (p) l.harga = hargaCabang(hargaMap, l.item_id, p.unit, Number(p.sell_price));
    }

    // Minimum jual ditegakkan di server juga — kalau hanya di layar, kasir bisa
    // menembusnya lewat halaman yang sudah lama terbuka atau submit langsung.
    const kurangMin = rows
      .map((l) => ({ l, p: l.item_id ? pusat.get(l.item_id) : undefined }))
      .filter(({ l, p }) => p && Number(p.min_sell_qty) > 0 && l.qty < Number(p.min_sell_qty));
    if (kurangMin.length > 0) {
      const pesan = kurangMin.map(({ p }) => `${p!.nama} minimal ${Number(p!.min_sell_qty)}`).join(", ");
      redirect(`/kasir?error=${encodeURIComponent(`Di bawah minimum jual: ${pesan}`)}`);
    }
  }

  // Promo dihitung ULANG di server dari master, bukan dipercaya dari keranjang:
  // layar kasir yang sudah lama terbuka bisa memegang promo yang sudah dicabut,
  // dan angka dari klien tidak boleh menentukan potongan uang.
  const promoAktif = await loadPromoAktif(supabase, branchId);
  for (const h of hitungPromoKeranjang(promoAktif, rows)) {
    const baris = rows.find((l) => l.item_id === h.item_id);
    if (baris) baris.promo_discount = h.potongan;
  }

  // Urutan kalkulasi (§6): diskon item → diskon transaksi + voucher → poin (lib/pos-calc — jangan diubah).
  const subtotal = rows.reduce((a, l) => a + l.qty * l.harga, 0);
  const afterItems = subtotal - rows.reduce((a, l) => a + lineDiscount(l), 0);

  // voucher divalidasi server-side (persen dihitung setelah diskon item).
  // Masa berlaku ikut dicek di sini — kode yang bocor ke luar tidak boleh terus
  // dipakai hanya karena kasir masih hafal kodenya.
  let voucherVal = 0;
  if (voucherCode) {
    const { data: v } = await supabase
      .from("vouchers").select("code, tipe, nilai, is_active, valid_from, valid_until")
      .eq("code", voucherCode).maybeSingle();
    const wibToday = new Date(new Date().getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const tolak = pesanVoucherDitolak((v ?? null) as VoucherRow | null, wibToday);
    if (tolak) redirect(`/kasir?error=${encodeURIComponent(tolak)}`);
    voucherVal = potonganVoucher(afterItems, v!.tipe, Number(v!.nilai));
  }

  // poin divalidasi terhadap saldo pelanggan sebenarnya. Golongan pelanggan
  // dibaca sekalian: diskon & rumus poinnya diambil dari master lewat customer_id,
  // BUKAN dari form — kalau dari form, kasir bisa mengarang diskon golongan.
  let poinDigunakan = 0;
  let custPoints = 0;
  let diskonKategori = 0;
  let rupiahPerPoin: number | null = null;
  if (customerId) {
    const { data: cust } = await supabase
      .from("customers")
      .select("points, total_spending, category_id, customer_categories(diskon_persen, rupiah_per_poin, is_active)")
      .eq("id", customerId).single();
    custPoints = cust?.points ?? 0;
    poinDigunakan = Math.min(poinReq, custPoints);

    const rel = cust?.customer_categories as
      | { diskon_persen: number; rupiah_per_poin: number; is_active: boolean }
      | { diskon_persen: number; rupiah_per_poin: number; is_active: boolean }[]
      | null | undefined;
    const kat = Array.isArray(rel) ? rel[0] : rel;
    if (kat?.is_active) {
      // Diskon dihitung PER BARIS: sejak 0082 tiap barang bisa punya persen
      // sendiri untuk golongan ini. Tanpa pengecualian, hasilnya sama dengan
      // perhitungan rata yang lama.
      const [aturan, infoBarang] = await Promise.all([
        loadAturanDiskon(supabase, cust?.category_id),
        loadInfoBarang(supabase, cartIds),
      ]);
      diskonKategori = diskonGolonganKeranjang(
        rows.map((l) => ({ item_id: l.item_id, qty: l.qty, harga: l.harga })),
        aturan, Number(kat.diskon_persen), infoBarang,
      );
      rupiahPerPoin = Number(kat.rupiah_per_poin);
    }
  } else if (poinReq > 0) {
    redirect(`/kasir?error=${encodeURIComponent("Pilih pelanggan dulu untuk pakai poin")}`);
  }

  const potonganPoin = poinDigunakan * RUPIAH_PER_POIN;
  // Diskon golongan digabung ke potongan tingkat transaksi bersama diskon manual
  // kasir, jadi urutan §6 (item → transaksi → poin) tetap utuh.
  const totals = computeTotals(rows, diskon + diskonKategori, voucherVal, potonganPoin);
  poinDigunakan = totals.poin; // poin efektif setelah cap (tidak melebihi sisa tagihan)
  const totalDiskon = totals.itemDiscountTotal + totals.txnLevel + totals.poin;
  const total = totals.total;
  const kembali = metode === "Tunai" ? Math.max(0, bayar - total) : 0;
  if (metode === "Tunai" && bayar < total) redirect(`/kasir?error=${encodeURIComponent("Uang bayar kurang")}`);

  const now = new Date();
  const prefix = `POS-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const seqStruk = await urutanBerikutnya(supabase, {
    table: "sales", column: "no_struk", prefix: `${prefix}-`, pad: 4,
  });
  const noStruk = formatNomor(`${prefix}-`, seqStruk, 4);

  // Poin ikut golongan pelanggan (migrasi 0078); golongan tanpa pengaturan
  // sendiri tetap Rp1.000 = 1 poin seperti sebelumnya.
  const poinEarned = customerId ? poinDidapat(total, rupiahPerPoin) : 0;

  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .insert({
      branch_id: branchId, customer_id: customerId, no_struk: noStruk,
      subtotal, discount: totalDiskon - diskonKategori, diskon_kategori: diskonKategori,
      total, metode_bayar: metode, bayar: metode === "Tunai" ? bayar : total,
      kembali, poin_earned: poinEarned, poin_digunakan: poinDigunakan, voucher_code: voucherCode,
      cashier_id: user?.id ?? null, shift_id: shift!.id,
    })
    .select("id").single();
  if (saleErr || !sale) redirect(`/kasir?error=${encodeURIComponent(saleErr?.message ?? "Gagal simpan transaksi")}`);

  // Stok dipotong DULU, baru baris struk disimpan: modal FIFO tiap baris ikut
  // dicatat (sale_items.hpp, migrasi 0084) supaya retur nanti bisa menilai
  // barang yang kembali persis seperti saat keluar.
  let hppFifo = 0;
  const hppBaris = new Map<string, number>();
  const { data: wh } = await supabase
    .from("warehouses").select("id").eq("branch_id", branchId).eq("is_active", true).order("type").limit(1).maybeSingle();
  if (wh) {
    for (const r of rows) {
      if (!r.item_id) continue;
      try {
        const { cost } = await stockOut(supabase, {
          warehouseId: wh.id, itemId: r.item_id, qty: r.qty, source: "sale", ref: noStruk,
        });
        hppFifo += cost;
        hppBaris.set(r.item_id, (hppBaris.get(r.item_id) ?? 0) + cost);
      } catch (e) {
        // Struk sudah tersimpan — jangan bikin kasir crash di depan pelanggan.
        // ponytail: dicatat ke log server saja; kalau ini pernah kejadian beneran,
        // naikkan jadi notifikasi backoffice + antrean koreksi stok.
        console.error(`[stok] gagal potong stok ${noStruk} item ${r.item_id}:`, e);
      }
    }
  }

  const { error: itErr } = await supabase.from("sale_items").insert(
    rows.map((l) => ({
      sale_id: sale!.id, item_id: l.item_id, nama: l.nama, qty: l.qty, harga: l.harga,
      target_species: l.target_species ?? "Universal",
      item_discount_type: l.item_discount_type ?? null,
      item_discount_value: Math.max(0, Number(l.item_discount_value) || 0),
      hpp: l.item_id ? (hppBaris.get(l.item_id) ?? 0) : null,
    }))
  );
  if (itErr) redirect(`/kasir?error=${encodeURIComponent(itErr.message)}`);

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
  const kasCode = await kodeAkunBayar(supabase, metode, branchId);
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
