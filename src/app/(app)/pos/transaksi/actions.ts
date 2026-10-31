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
import { loadPromoAktif, totalPotonganPromo } from "@/lib/promo-hitung";
import { aggregateServiceLines, serviceLinePromos } from "@/lib/service-line-promos";
import { simpanBernomor } from "@/lib/simpan-bernomor";
import { loggedInCashier, validateServicePerformerRows } from "@/lib/service-performers-server";
import type { ServicePerformersInput } from "@/lib/service-performers";
import { readCompleteList } from "@/lib/checked-list";
import { resolvePosPayments } from "@/lib/pos-payments";
import { quotePosMerchantFees } from "@/lib/pos-merchant-fees";
import { PESAN_STRUK_BENTROK, posCheckoutIdentity, resumePosCheckout } from "@/lib/pos-checkout-identity";
import { posSubtotal, posNetTotal, roundPosMoney } from "@/lib/pos-money";
import { recomputeCustomerTier } from "@/lib/customer-tier";
import { processQuestProgress } from "@/lib/quest-hook";
import { normalizeKode, pesanVoucherDitolak, potonganVoucher, type VoucherRow } from "@/lib/voucher";
import { bacaKodeKampanye, pesanGagalKampanye, pesanKampanyeDitolak, promoDenganKode } from "@/lib/kode-kampanye";
import { priceFloorFindings } from "@/lib/cashier-price-floor";
import { quoteSaleLineCosts } from "@/lib/sale-fifo-quote";
import { requirePosRetailWarehouse } from "@/lib/pos-retail-warehouse";
import { hppWarningConfirmed, hppWarningQuery, hppWarningsFrom, type HppWarning } from "@/lib/hpp-warning";

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
  // C05: layar back-office hanya menerima KODE KAMPANYE (bukan kode voucher mentah) —
  // kebijakan voucher mentah masih menunggu keputusan pemilik dan tidak diperluas ke sini.
  const kodeMasuk = normalizeKode(formData.get("voucherCode")) || null;

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
  const rawRows = cart.filter((l) => l.nama?.trim() && Number(l.qty) > 0)
    .map(l => ({ ...l, promo_discount: 0 }));
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
    cartIds.length ? readCompleteList<{ id: string; code: string; item_type: string; tindakan_kategori: string | null }>((from, to) => supabase.from("items")
      .select("id, code, item_type, tindakan_kategori", { count: "exact" }).in("id", [...new Set(cartIds)]).order("id").range(from, to), "Jenis barang POS", { maxRows: null }) : [],
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
  const kampanye = kodeMasuk ? await bacaKodeKampanye(supabase, kodeMasuk) : null;
  if (kodeMasuk && !kampanye) {
    redirect(`/pos/transaksi?error=${encodeURIComponent(`Kode kampanye ${kodeMasuk} tidak ditemukan`)}`);
  }
  // Kode terikat promo: promo itu ikut dipotong di transaksi ini (juga yang tidak otomatis).
  const promoKodeId = kampanye?.promo_id ?? null;
  const promoAktif = promoDenganKode(await loadPromoAktif(supabase, branchId, promoKodeId ? [promoKodeId] : []), promoKodeId);
  const rincianPromo = serviceLinePromos(
    promoAktif, rows.map((l) => ({ ...l, item_id: l.item_id ?? "", officialPrice: l.harga, manualOverride: false })),
  );
  if (kampanye) {
    const tolak = pesanKampanyeDitolak(kampanye,
      promoAktif.some((p) => p.id === promoKodeId), rincianPromo.some((h) => h.promoId === promoKodeId));
    if (tolak) redirect(`/pos/transaksi?error=${encodeURIComponent(tolak)}`);
  }
  const potonganPromo = totalPotonganPromo(rincianPromo);
  // Rinciannya ikut disimpan ke baris struk (migrasi 0127) supaya laporan promo
  // bisa menyebut program mana yang menghabiskan uang, bukan cuma totalnya.
  const promoPerLine = new Map(rincianPromo.map((h) => [h.lineIndex, h]));
  // Boundary follows potential DB coverage, not the winning quote. A reviewed
  // pool may activate, or a stronger legacy winner may change, after this read.
  const reviewedPoolCodes = new Set([
    "DRC8993374326970", "DRC8993374326987", "DRC8993374326994",
    "DRC8994125000118", "DRC8994125000064",
  ]);
  const quantityPoolRequiresAtomic = rows.some(l => l.item_id && (
    reviewedPoolCodes.has(itemTypes.get(l.item_id)?.code ?? "") ||
    promoAktif.some(p => p.discountMode === "quantity_pool" && p.itemIds.includes(l.item_id!))
  ));

  // Diskon golongan diambil dari master lewat customer_id — BUKAN dari form.
  // Kalau dibaca dari form, kasir bisa mengarang diskon golongan sesukanya.
  let diskonKategori = 0;
  let rupiahPerPoin: number | null = null;
  let categoryId: string | null = null;
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
    categoryId = (cust?.category_id as string | null) ?? null;
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

  // Kode terikat voucher: syarat & rumus voucher itu apa adanya, dihitung dari nilai
  // setelah promo — urutan yang sama dengan /kasir (§6).
  const voucherCode = kampanye?.voucher_code ?? null;
  let voucherVal = 0;
  if (kampanye && !kampanye.promo_id) {
    const { data: v } = voucherCode ? await supabase
      .from("vouchers")
      .select("code, tipe, nilai, is_active, valid_from, valid_until, max_potongan, min_belanja, boleh_gabung_promo, customer_id, category_id")
      .eq("code", voucherCode).maybeSingle() : { data: null };
    const dasarVoucher = posNetTotal(subtotal, potonganPromo);
    const tolak = pesanVoucherDitolak((v ?? null) as VoucherRow | null, hariIniWIB(), {
      dasar: dasarVoucher, adaPromoOtomatis: rincianPromo.length > 0, customerId, categoryId,
    });
    if (tolak) redirect(`/pos/transaksi?error=${encodeURIComponent(tolak)}`);
    voucherVal = potonganVoucher(dasarVoucher, v as VoucherRow);
  }

  const total = posNetTotal(subtotal, potonganPromo, diskonKategori, discount, voucherVal);
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

  const hppGoods = rows.filter(row => row.item_id && row.item_type === "Persediaan");
  let warehouseId: string | null = null;
  if (hppGoods.length > 0 || quantityPoolRequiresAtomic) {
    try { warehouseId = await requirePosRetailWarehouse(supabase, branchId); }
    catch (error) { redirect(`/pos/transaksi?error=${encodeURIComponent(error instanceof Error ? error.message : "Gudang retail cabang tidak tersedia")}`); }
  }

  // P03: back office boleh menjual di bawah HPP, tetapi hanya setelah peringatan yang
  // menyebut barangnya dikonfirmasi. Perkiraan HPP = FIFO gudang saat ini.
  if (warehouseId && hppGoods.length > 0) {
    let warnings: HppWarning[] = [];
    try {
      const lines = rows.map((row, index) => ({ ...row, promo_discount: row.item_id ? (promoPerLine.get(index)?.potongan ?? 0) : 0 }));
      const costs = await quoteSaleLineCosts(supabase, warehouseId, rows.map(row => ({
        item_id: row.item_id, item_type: row.item_type, qty: Number(row.qty), faktor: row.faktor,
      })));
      warnings = hppWarningsFrom(priceFloorFindings(lines, total, costs));
    } catch (error) {
      // Peringatan tidak boleh menghentikan transaksi bila HPP tidak terbaca; FIFO riil tetap dibukukan.
      console.error("[pos/transaksi] perkiraan HPP gagal dibaca:", error);
    }
    if (!hppWarningConfirmed(formData, warnings)) redirect(`/pos/transaksi?${hppWarningQuery(warnings)}`);
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

  // Poin ikut golongan pelanggan (migrasi 0078) — rumus sama dengan layar kasir.
  const poin = customerId ? poinDidapat(total, rupiahPerPoin) : 0;

  // Formatnya dibaca dari master penomoran; bawaannya POS-YYYYMMDD-NNNN.
  // Nomor yang sama bisa terbaca dua orang sekaligus; yang kalah mengulang kepala
  // struk dengan nomor baru (lib/simpan-bernomor) — belum ada baris atau stok
  // yang tersentuh pada titik ini.
  const { data: sale, error: saleErr, nomor: noStruk, bentrok } = await simpanBernomor<{ id: string }>(
    supabase,
    { jenis: "POS", tanggal: hariIniWIB(), table: "sales", column: "no_struk" },
    (no_struk) => supabase
      .from("sales")
      .insert({
        branch_id: branchId, customer_id: customerId, pet_id: petId, no_struk,
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
        // Kode kampanye dicatat apa adanya; batas pemakaiannya dijaga database (dihitung
        // hanya dari struk yang lunas, void membebaskan kuota) — sama dengan /kasir.
        ...(kampanye ? { voucher_code: voucherCode, campaign_code: kampanye.code } : {}),
      })
      .select("id").single(),
  );
  if (bentrok || saleErr || !sale) {
    await resumePosCheckout(supabase, user.id, checkout, "backoffice");
    const pesan = bentrok ? PESAN_STRUK_BENTROK : pesanGagalKampanye(saleErr?.message) ?? saleErr?.message ?? "Gagal simpan transaksi";
    redirect(`/pos/transaksi?error=${encodeURIComponent(pesan)}`);
  }

  let checkoutFailure: string | null = null;
  let quantityPoolFinalized = false;
  try {
    const pendingLines: { id: string; line: typeof rows[number] }[] = [];
    // Semua pelaksana dinormalisasi database sebelum ada pengeluaran stok.
    // Jika petugas berubah status setelah preflight, baris ditolak tanpa stok
    // barang lain dalam keranjang ikut terpotong.
    for (const [index, l] of rows.entries()) {
      const { data: insertedLine, error: itemErr } = await supabase.from("sale_items").insert({
        sale_id: sale.id, item_id: l.item_id, nama: l.nama, qty: l.qty, harga: l.harga,
        source_position: index,
        quantity_pool_claim: promoAktif.some(p =>
          p.id === promoPerLine.get(index)?.promoId && p.discountMode === "quantity_pool"),
        target_species: l.target_species, satuan: l.satuan, faktor: l.faktor,
        service_performers: l.service_performers,
        promo_id: l.item_id ? (promoPerLine.get(index)?.promoId ?? null) : null,
        promo_discount: l.item_id ? (promoPerLine.get(index)?.potongan ?? 0) : 0,
        hpp: l.item_id ? 0 : null,
      }).select("id").single();
      if (itemErr || !insertedLine) throw new Error(itemErr?.message ?? "Gagal menyimpan rincian transaksi");
      pendingLines.push({ id: insertedLine.id, line: l });
    }
    if (quantityPoolRequiresAtomic) {
      if (!warehouseId) throw new Error("Gudang retail cabang tidak tersedia untuk memotong stok");
      // New-rule validation may reject a stale master at finalization. Keep
      // original stock writers and finalizer in ONE transaction so that such
      // rejection cannot leave separate backoffice HTTP stock issues behind.
      const { data: posted, error: postErr } = await supabase.rpc("quantity_pool_post_backoffice_atomic", {
        p_sale_id: sale.id, p_warehouse_id: warehouseId,
      });
      if (postErr || posted?.sale_id !== sale.id || posted?.finalized !== true || posted?.checked !== true) {
        throw new Error(postErr?.message ?? "Stok dan harga neto promo belum berhasil difinalkan");
      }
      quantityPoolFinalized = true;
    } else for (const { id, line } of pendingLines) {
      if (!warehouseId || !line.item_id) continue;
      const { cost } = await stockOut(supabase, {
        warehouseId, itemId: line.item_id, qty: toBaseQty(line.qty, line.faktor), source: "sale", ref: noStruk,
      });
      const { error: costError } = await supabase.from("sale_items").update({ hpp: cost })
        .eq("id", id).eq("sale_id", sale.id).select("id").single();
      if (costError) throw new Error(costError.message);
    }
  } catch (error) {
    checkoutFailure = error instanceof Error ? error.message : "Gagal memproses stok atau rincian transaksi";
  }
  if (checkoutFailure) {
    if (quantityPoolRequiresAtomic) await resumePosCheckout(supabase, user.id, checkout, "backoffice", sale.id);
    const { error: cleanupErr } = await supabase.from("sales").delete().eq("id", sale.id);
    if (cleanupErr) console.error(`[checkout] gagal bersihkan sales ${sale.id}:`, cleanupErr.message);
    redirect(`/pos/transaksi?error=${encodeURIComponent(checkoutFailure)}`);
  }

  const { data: finalized, error: finalizationErr } = quantityPoolFinalized
    ? { data: { sale_id: sale.id, finalized: true }, error: null }
    : await supabase.rpc("finalize_pos_sale", { p_sale_id: sale.id });
  if (finalizationErr || finalized?.sale_id !== sale.id || finalized?.finalized !== true) {
    await resumePosCheckout(supabase, user.id, checkout, "backoffice", sale.id);
    const { error: cleanupErr } = await supabase.from("sales").delete().eq("id", sale.id);
    if (cleanupErr) console.error(`[checkout] gagal bersihkan sales ${sale.id}:`, cleanupErr.message);
    redirect(`/pos/transaksi?error=${encodeURIComponent(pesanGagalKampanye(finalizationErr?.message) ?? finalizationErr?.message ?? "Pembukuan transaksi belum selesai. Coba kembali.")}`);
  }

  if (customerId) await recomputeCustomerTier(supabase, customerId);

  // Progres quest staf (termasuk customer baru Q01) — best effort, tidak mem-block
  // pembayaran; yang gagal diulang otomatis pada checkout berikutnya.
  await processQuestProgress(supabase, { saleId: sale.id });

  redirect(`/pos/struk/${sale!.id}?draft_done=${encodeURIComponent(checkout.key)}`);
}
