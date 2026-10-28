"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";
import { stockOut } from "@/lib/inventory";
import { loadUnitOptions, resolveSubmittedUnit, toBaseQty } from "@/lib/satuan";
import { loadHargaCabang, hargaCabang } from "@/lib/harga-cabang";
import {
  diskonGolonganKeranjang, loadAturanDiskon, loadInfoBarang, poinDidapat,
} from "@/lib/harga-golongan";
import { loadPromoAktif } from "@/lib/promo-hitung";
import { aggregateServiceLines } from "@/lib/service-line-promos";
import { normalizeKode, type VoucherRow } from "@/lib/voucher";
import { bacaKodeKampanye, pesanGagalKampanye } from "@/lib/kode-kampanye";
import { hitungKodeKampanyePos } from "@/lib/kode-kampanye-pos";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { loggedInCashier, validateServicePerformerRows } from "@/lib/service-performers-server";
import type { ServicePerformersInput } from "@/lib/service-performers";
import { readCompleteList } from "@/lib/checked-list";
import { resolvePosPayments } from "@/lib/pos-payments";
import { quotePosMerchantFees } from "@/lib/pos-merchant-fees";
import { posCheckoutIdentity, resumePosCheckout } from "@/lib/pos-checkout-identity";
import { posSubtotal, posNetTotal, roundPosMoney } from "@/lib/pos-money";
import { recomputeCustomerTier } from "@/lib/customer-tier";

type CartLine = {
  item_id: string | null; nama: string; qty: number; harga: number; target_species: string;
  satuan?: string | null; faktor?: number;
  service_performers?: ServicePerformersInput | null;
  item_type?: string;
};


export async function checkoutSale(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const branchId = String(formData.get("branchId") ?? "");
  const customerId = String(formData.get("customerId") ?? "") || null;
  const petId = String(formData.get("petId") ?? "") || null;
  const metode = String(formData.get("metode") ?? "Tunai");
  const discount = Number(formData.get("discount")) || 0;
  const bayar = Number(formData.get("bayar")) || 0;

  if (!branchId) redirect(`/pos/transaksi?error=${encodeURIComponent("Pilih cabang dulu")}`);
  let checkout: ReturnType<typeof posCheckoutIdentity>;
  try { checkout = posCheckoutIdentity(formData, branchId); }
  catch (error) { redirect(`/pos/transaksi?error=${encodeURIComponent(error instanceof Error ? error.message : "Identitas transaksi tidak valid")}`); }
  await resumePosCheckout(supabase, user.id, checkout, "backoffice");
  const cashier = await loggedInCashier(supabase, user.id, branchId);

  let cart: CartLine[] = [];
  try {
    const submitted = JSON.parse(String(formData.get("cart") ?? "[]"));
    cart = Array.isArray(submitted) ? submitted : [];
  } catch {
    cart = [];
  }
  const rawRows = cart.filter((l) => l.nama?.trim() && Number(l.qty) > 0);
  if (rawRows.length === 0) redirect(`/pos/transaksi?error=${encodeURIComponent("Keranjang kosong")}`);

  // Periode terkunci = struk tersimpan tapi jurnal pendapatannya hilang diam-diam.
  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) redirect(`/pos/transaksi?error=${encodeURIComponent(pesanPeriode)}`);

  // Faktor satuan diambil ulang dari master — nilai dari keranjang cuma petunjuk
  // satuan mana yang dipilih, bukan sumber kebenaran konversi stok.
  const cartIds = rawRows.map((l) => l.item_id).filter((x): x is string => !!x);
  const [unitOpts, hargaMap, catalogue] = await Promise.all([
    loadUnitOptions(supabase, cartIds),
    loadHargaCabang(supabase, branchId, cartIds),
    cartIds.length ? readCompleteList<{ id: string; item_type: string; tindakan_kategori: string | null }>((from, to) => supabase.from("items")
      .select("id, item_type, tindakan_kategori", { count: "exact" }).in("id", [...new Set(cartIds)]).order("id").range(from, to), "Jenis barang POS", { maxRows: null }) : [],
  ]);
  const itemTypes = new Map(catalogue.map(item => [item.id, item]));
  let performerRows: CartLine[];
  try {
    const typedRows = rawRows.map(line => ({ ...line, item_type: line.item_id ? itemTypes.get(line.item_id)?.item_type : undefined,
      tindakan_kategori: line.item_id ? itemTypes.get(line.item_id)?.tindakan_kategori : null }));
    const normalized = await validateServicePerformerRows(supabase, branchId, typedRows);
    performerRows = typedRows.map((line, index) => ({ ...line, service_performers: normalized[index] }));
  } catch (error) {
    redirect(`/pos/transaksi?error=${encodeURIComponent(error instanceof Error ? error.message : "Pelaksana jasa tidak valid")}`);
  }
  // Harga juga diambil ulang dari master + pengecualian cabang: keranjang cuma
  // menentukan barang & satuan, tidak boleh menentukan harganya sendiri.
  const rows = performerRows.map((l) => {
    const opts = l.item_id ? unitOpts.get(l.item_id) : undefined;
    const u = l.item_id ? resolveSubmittedUnit(opts ?? [], l.satuan) : null;
    return {
      ...l,
      satuan: u?.unit ?? l.satuan ?? null,
      faktor: u?.factor ?? 1,
      harga: l.item_id && u ? hargaCabang(hargaMap, l.item_id, u.unit, u.sell_price) : l.harga,
    };
  });

  const subtotal = posSubtotal(rows);

  // Promo otomatis (migrasi 0079) — dihitung dari master, aturannya sama persis
  // dengan layar kasir. Sengaja dipasang di KEDUA jalur POS: diskon golongan
  // dulu sempat hanya jalan di sini dan tidak di /kasir, dan selisih diam-diam
  // antara dua layar yang sama-sama menagih uang itu mahal ketahuannya.
  //
  // Kode kampanye (C05) diterjemahkan ke voucher/promo tujuannya dengan rumus yang
  // sama dengan layar ini (lib/kode-kampanye-pos). Voucher biasa tidak diterima di
  // sini; batas pemakaian kode dijaga database saat struk ditulis dan dibayar.
  const kodeMasuk = normalizeKode(formData.get("voucherCode")) || null;
  const kampanye = await bacaKodeKampanye(supabase, kodeMasuk);
  const [promoAktif, voucherKode, customerVoucher] = await Promise.all([
    loadPromoAktif(supabase, branchId, kampanye?.promo_id ? [kampanye.promo_id] : []),
    kampanye?.voucher_code
      ? supabase.from("vouchers")
        .select("code, tipe, nilai, is_active, valid_from, valid_until, max_potongan, min_belanja, boleh_gabung_promo, customer_id, category_id")
        .eq("code", kampanye.voucher_code).maybeSingle().then(({ data }) => (data ?? null) as VoucherRow | null)
      : null,
    kampanye?.voucher_code && customerId
      ? supabase.from("customers").select("category_id").eq("id", customerId).maybeSingle()
        .then(({ data }) => (data?.category_id as string | null) ?? null)
      : null,
  ]);
  const kodePos = hitungKodeKampanyePos({
    kode: kodeMasuk, daftar: kampanye ? [kampanye] : [], promos: promoAktif,
    cart: rows.map((l) => ({ ...l, item_id: l.item_id ?? "" })), subtotal,
    voucher: voucherKode, hariIni: hariIniWIB(), customerId, categoryId: customerVoucher,
  });
  if (kodePos.tolak) redirect(`/pos/transaksi?error=${encodeURIComponent(kodePos.tolak)}`);
  const rincianPromo = kodePos.rincianPromo;
  const potonganPromo = kodePos.potonganPromo;
  // Rinciannya ikut disimpan ke baris struk (migrasi 0127) supaya laporan promo
  // bisa menyebut program mana yang menghabiskan uang, bukan cuma totalnya.
  const promoPerLine = new Map(rincianPromo.map((h) => [h.lineIndex, h]));

  // Diskon golongan diambil dari master lewat customer_id — BUKAN dari form.
  // Kalau dibaca dari form, kasir bisa mengarang diskon golongan sesukanya.
  let diskonKategori = 0;
  let rupiahPerPoin: number | null = null;
  if (customerId) {
    const { data: cust } = await supabase
      .from("customers")
      .select("category_id, customer_categories(diskon_persen, rupiah_per_poin, is_active)")
      .eq("id", customerId)
      .maybeSingle();
    const rel = cust?.customer_categories as
      | { diskon_persen: number; rupiah_per_poin: number; is_active: boolean }
      | { diskon_persen: number; rupiah_per_poin: number; is_active: boolean }[]
      | null
      | undefined;
    const kat = Array.isArray(rel) ? rel[0] : rel;
    if (kat?.is_active) {
      // Per baris sejak 0082 — aturan sama persis dengan layar kasir.
      const [aturan, infoBarang] = await Promise.all([
        loadAturanDiskon(supabase, cust?.category_id),
        loadInfoBarang(supabase, cartIds),
      ]);
      diskonKategori = diskonGolonganKeranjang(
        aggregateServiceLines(rows.map((l) => ({ ...l, item_id: l.item_id ?? "" }))),
        aturan, Number(kat.diskon_persen), infoBarang,
      );
      rupiahPerPoin = Number(kat.rupiah_per_poin);
    }
  }

  const total = posNetTotal(subtotal, potonganPromo, kodePos.potonganVoucher, diskonKategori, discount);
  const invoiceSubtotal = roundPosMoney(subtotal);
  const invoiceDiscount = posNetTotal(invoiceSubtotal, total);
  const invoiceCategoryDiscount = Math.min(roundPosMoney(diskonKategori), invoiceDiscount);
  let payment: ReturnType<typeof resolvePosPayments>;
  let quote: ReturnType<typeof quotePosMerchantFees>;
  try {
    quote = quotePosMerchantFees({ total, method: metode, payments: String(formData.get("split_payments") ?? ""), feePercent: Number(formData.get("merchant_fee_percent") ?? 0) });
    payment = resolvePosPayments({ total: quote.total, method: metode, bayar, payments: metode === "Split" ? quote.parts : [] });
  } catch (error) {
    redirect(`/pos/transaksi?error=${encodeURIComponent(error instanceof Error ? error.message : "Rincian pembayaran tidak valid")}`);
  }

  // §2.1: tautkan ke shift kasir yang sedang terbuka (kalau ada) untuk rekonsiliasi kas.
  const { data: openShift } = await supabase
    .from("cashier_shifts").select("id")
    .eq("branch_id", branchId).eq("opened_by", user?.id ?? "").eq("status", "open")
    // Satu orang boleh punya shift petshop DAN klinik terbuka bersamaan (index unik
    // per jenis). Tanpa saringan ini kueri mengembalikan dua baris, maybeSingle gagal,
    // dan penjualan tersimpan dengan shift_id kosong — uangnya masuk laci tapi tidak
    // pernah ikut dihitung saat tutup shift, jadi selisih kurang palsu.
    .eq("shift_type", "petshop").maybeSingle();

  // Formatnya dibaca dari master penomoran; bawaannya POS-YYYYMMDD-NNNN.
  const { nomor: noStruk } = await nomorBerikutnya(supabase, "POS", hariIniWIB(), {
    table: "sales", column: "no_struk",
  });

  // Poin ikut golongan pelanggan (migrasi 0078) — rumus sama dengan layar kasir.
  const poin = customerId ? poinDidapat(total, rupiahPerPoin) : 0;

  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .insert({
      branch_id: branchId, customer_id: customerId, pet_id: petId, no_struk: noStruk,
      // Potongan promo digabung ke `discount` (potongan tingkat transaksi) —
      // `diskon_kategori` sengaja tetap berisi diskon golongan saja supaya
      // laporan yang memisahkan keduanya tidak berubah artinya.
      subtotal: invoiceSubtotal, discount: posNetTotal(invoiceDiscount, invoiceCategoryDiscount),
      diskon_kategori: invoiceCategoryDiscount,
      total: quote.total, merchant_fee_total: quote.feeTotal, metode_bayar: payment.method, bayar: payment.bayar, kembali: payment.kembali,
      payment_plan: quote.parts, poin_earned: poin,
      checkout_key: checkout.key, checkout_fingerprint: checkout.fingerprint,
      cashier_id: user?.id ?? null, shift_id: openShift?.id ?? null,
      cashier_name: cashier.name, salesperson_id: cashier.employeeId,
      // Old schema keeps working until the C05 database step: no code → no new columns.
      ...(kodePos.campaignCode ? { campaign_code: kodePos.campaignCode, voucher_code: kodePos.voucherCode } : {}),
    })
    .select("id").single();
  if (saleErr || !sale) {
    await resumePosCheckout(supabase, user.id, checkout, "backoffice");
    redirect(`/pos/transaksi?error=${encodeURIComponent(pesanGagalKampanye(saleErr?.message) ?? saleErr?.message ?? "Gagal simpan transaksi")}`);
  }

  // HPP disimpan per baris agar finalisasi database membukukan biaya FIFO riil.
  const { data: wh } = await supabase
    .from("warehouses").select("id").eq("branch_id", branchId).eq("is_active", true).order("type").limit(1).maybeSingle();
  let checkoutFailure: string | null = null;
  try {
    const pendingLines: { id: string; line: typeof rows[number] }[] = [];
    // Semua pelaksana dinormalisasi database sebelum ada pengeluaran stok.
    // Jika petugas berubah status setelah preflight, baris ditolak tanpa stok
    // barang lain dalam keranjang ikut terpotong.
    for (const [index, l] of rows.entries()) {
      const { data: insertedLine, error: itemErr } = await supabase.from("sale_items").insert({
        sale_id: sale.id, item_id: l.item_id, nama: l.nama, qty: l.qty, harga: l.harga,
        target_species: l.target_species, satuan: l.satuan, faktor: l.faktor,
        service_performers: l.service_performers,
        promo_id: l.item_id ? (promoPerLine.get(index)?.promoId ?? null) : null,
        promo_discount: l.item_id ? (promoPerLine.get(index)?.potongan ?? 0) : 0,
        hpp: l.item_id ? 0 : null,
      }).select("id").single();
      if (itemErr || !insertedLine) throw new Error(itemErr?.message ?? "Gagal menyimpan rincian transaksi");
      pendingLines.push({ id: insertedLine.id, line: l });
    }
    for (const { id, line } of pendingLines) {
      if (!wh || !line.item_id) continue;
      const { cost } = await stockOut(supabase, {
        warehouseId: wh.id, itemId: line.item_id, qty: toBaseQty(line.qty, line.faktor), source: "sale", ref: noStruk,
      });
      const { error: costError } = await supabase.from("sale_items").update({ hpp: cost })
        .eq("id", id).eq("sale_id", sale.id).select("id").single();
      if (costError) throw new Error(costError.message);
    }
  } catch (error) {
    checkoutFailure = error instanceof Error ? error.message : "Gagal memproses stok atau rincian transaksi";
  }
  if (checkoutFailure) {
    const { error: cleanupErr } = await supabase.from("sales").delete().eq("id", sale.id);
    if (cleanupErr) console.error(`[checkout] gagal bersihkan sales ${sale.id}:`, cleanupErr.message);
    redirect(`/pos/transaksi?error=${encodeURIComponent(checkoutFailure)}`);
  }

  const { data: finalized, error: finalizationErr } = await supabase.rpc("finalize_pos_sale", { p_sale_id: sale.id });
  if (finalizationErr || finalized?.sale_id !== sale.id || finalized?.finalized !== true) {
    await resumePosCheckout(supabase, user.id, checkout, "backoffice", sale.id);
    const { error: cleanupErr } = await supabase.from("sales").delete().eq("id", sale.id);
    if (cleanupErr) console.error(`[checkout] gagal bersihkan sales ${sale.id}:`, cleanupErr.message);
    redirect(`/pos/transaksi?error=${encodeURIComponent(pesanGagalKampanye(finalizationErr?.message) ?? finalizationErr?.message ?? "Pembukuan transaksi belum selesai. Coba kembali.")}`);
  }

  if (customerId) await recomputeCustomerTier(supabase, customerId);

  redirect(`/pos/struk/${sale!.id}?draft_done=${encodeURIComponent(checkout.key)}`);
}
