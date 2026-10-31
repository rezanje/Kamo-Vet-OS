"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadHargaCabang, hargaCabang, applyHargaCabang } from "@/lib/harga-cabang";
import { loadUnitOptions, resolveSubmittedUnit, toBaseQty } from "@/lib/satuan";
import { computeTotals, lineDiscount, linePromoApplied } from "@/lib/pos-calc";
import { processQuestProgress } from "@/lib/quest-hook";
import { recomputeCustomerTier } from "@/lib/customer-tier";
import { pesanVoucherDitolak, potonganVoucher, normalizeKode, type VoucherRow } from "@/lib/voucher";
import { bacaKode, bacaKodeKampanye, cekVoucherLewatKampanye, pesanGagalKampanye, pesanKampanyeDitolak, promoDenganKode } from "@/lib/kode-kampanye";
import {
  diskonGolonganKeranjang, loadAturanDiskon, loadInfoBarang, poinDidapat,
} from "@/lib/harga-golongan";
import { loadPromoAktif } from "@/lib/promo-hitung";
import { simpanBernomor } from "@/lib/simpan-bernomor";
import { hariIniWIB } from "@/lib/tanggal";
import { hargaTingkat } from "@/lib/harga-tingkat";
import { cekPeriode } from "@/lib/jurnal-guard";
import { serviceLinePromos, aggregateServiceLines } from "@/lib/service-line-promos";
import { loggedInCashier, validateServicePerformerRows } from "@/lib/service-performers-server";
import type { ServicePerformersInput } from "@/lib/service-performers";
import { resolvePosPayments } from "@/lib/pos-payments";
import { quotePosMerchantFees } from "@/lib/pos-merchant-fees";
import { PESAN_STRUK_BENTROK, posCheckoutIdentity, resumePosCheckout } from "@/lib/pos-checkout-identity";
import { posSubtotal, posNetTotal, roundPosMoney } from "@/lib/pos-money";
import { loadKasirGroupComponents } from "@/lib/kasir-catalog";
import { cashierPriceFloorDbMessage, cashierPriceFloorIssue, isPriceFloorGoods } from "@/lib/cashier-price-floor";
import { quoteSaleLineCosts } from "@/lib/sale-fifo-quote";
import {
  expandBarisGrup,
  kebutuhanStokCheckout,
  validasiKomponenGrup,
  type JenisKomponen,
  type ResepKomponenCheckout,
  type SnapshotKomponenGrup,
} from "@/lib/grup-barang";

type CartLine = {
  service_performers?: ServicePerformersInput | null;
  item_id: string; nama: string; qty: number; harga: number; target_species?: string;
  item_discount_type?: "nominal" | "percent" | null; item_discount_value?: number | null;
  promo_discount?: number | null;   // diisi server dari master, bukan dari klien
  satuan?: string; faktor?: number; // ditetapkan ulang dari master di bawah
  item_type?: JenisKomponen;         // ditetapkan ulang dari master di bawah
  tindakan_kategori?: string | null; // ditetapkan ulang dari master untuk aturan Grooming
  group_components?: SnapshotKomponenGrup[];
};

// Earning sekarang ikut golongan pelanggan (lib/harga-golongan → poinDidapat).
const RUPIAH_PER_POIN = 1;    // redeem: 1 poin = Rp1

export async function checkoutKasir(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const submittedReplacement = String(formData.get("replacementSaleId") ?? "");
  const replacementId = /^[0-9a-f-]{36}$/i.test(submittedReplacement) ? submittedReplacement : undefined;
  const failureUrl = `/kasir?${replacementId ? `replace_sale=${encodeURIComponent(replacementId)}&` : ""}error=`;
  let checkout: ReturnType<typeof posCheckoutIdentity>;
  try { checkout = posCheckoutIdentity(formData, ""); }
  catch (error) { redirect(`${failureUrl}${encodeURIComponent(error instanceof Error ? error.message : "Identitas transaksi tidak valid")}`); }
  await resumePosCheckout(supabase, user.id, checkout, "cashier", undefined, replacementId);

  // shift & cabang dari server (jangan percaya client).
  const { data: shift } = await supabase
    .from("cashier_shifts").select("id, branch_id")
    .eq("opened_by", user?.id ?? "").eq("status", "open").eq("shift_type", "petshop").maybeSingle();
  if (!shift) redirect(replacementId ? `${failureUrl}${encodeURIComponent("Buka shift pada cabang sumber untuk melanjutkan pengganti.")}` : "/kasir/mulai");
  const submittedShift = String(formData.get("operationalShiftId") ?? "");
  if (submittedShift && submittedShift !== shift.id) redirect(failureUrl + encodeURIComponent("Shift berubah. Muat ulang kasir sebelum membayar."));

  const branchId = shift!.branch_id;
  const customerId = String(formData.get("customerId") ?? "") || null;
  if (!customerId) redirect(`${failureUrl}${encodeURIComponent("Pilih pelanggan dulu sebelum bayar")}`);
  const cashier = await loggedInCashier(supabase, user.id, branchId);
  const salespersonId = cashier.employeeId;
  const metode = String(formData.get("metode") ?? "");
  if (!metode) redirect(`${failureUrl}${encodeURIComponent("Pilih metode pembayaran dulu")}`);
  const diskon = Math.max(0, Number(formData.get("diskon")) || 0);
  // normalizeKode = aturan yang sama dengan layar pengelola voucher, jadi kode
  // yang diketik pakai spasi ("HEMAT 10") tetap ketemu barisnya.
  // Kolom yang sama menerima kode kampanye (C05): kode itu diterjemahkan ke voucher
  // atau promo tujuannya di bawah, dan dicatat apa adanya di struk.
  const kodeMasuk = normalizeKode(formData.get("voucherCode")) || null;
  const poinReq = Math.max(0, Math.floor(Number(formData.get("poinDigunakan")) || 0));
  const bayar = Number(formData.get("bayar")) || 0;

  let cart: CartLine[] = [];
  try {
    cart = JSON.parse(String(formData.get("cart") ?? "[]"));
  } catch {
    cart = [];
  }
  const rows = cart.filter((l) => l.nama?.trim() && Number(l.qty) > 0)
    .map(l => ({ ...l, promo_discount: 0 }));
  if (rows.length === 0) redirect(`${failureUrl}${encodeURIComponent("Keranjang kosong")}`);

  // Struk boleh tersimpan hanya kalau jurnalnya juga bisa. Kalau periodenya terkunci,
  // penjualan akan tercatat di kasir tapi hilang dari buku besar tanpa peringatan.
  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) redirect(`${failureUrl}${encodeURIComponent(pesanPeriode)}`);

  // Harga ditetapkan ULANG di server: harga jual sekarang bisa beda per cabang
  // (migrasi 0073), jadi layar kasir yang sudah lama terbuka tidak boleh menentukan
  // harga sendiri. Baris tanpa item_id (ketikan manual) tetap pakai harga yang diisi.
  const cartIds = [...new Set(rows.map((l) => l.item_id).filter(Boolean))];
  const masterBuyPrices = new Map<string, number>();
  if (cartIds.length > 0) {
    const [{ data: itemsHarga }, hargaMap, unitMap] = await Promise.all([
      supabase.from("items").select("id, nama:name, unit, item_type, tindakan_kategori, sell_price, buy_price, min_sell_qty, is_active").in("id", cartIds),
      loadHargaCabang(supabase, branchId, cartIds),
      // Faktor satuan WAJIB dari master: faktor palsu dari klien = stok terpotong
      // lebih sedikit daripada barang yang benar-benar keluar dari rak.
      loadUnitOptions(supabase, cartIds),
    ]);
    type ItemHarga = {
      id: string; nama: string; unit: string; item_type: JenisKomponen;
      tindakan_kategori: string | null;
      sell_price: number; buy_price: number; min_sell_qty: number; is_active: boolean;
    };
    const pusat = new Map(
      ((itemsHarga ?? []) as ItemHarga[])
        .map((i) => [i.id, i]),
    );
    for (const item of pusat.values()) masterBuyPrices.set(item.id, Number(item.buy_price));
    const groupIds = [...new Set(rows
      .map((line) => line.item_id ? pusat.get(line.item_id) : undefined)
      .filter((item): item is ItemHarga => item?.item_type === "Grup")
      .map((item) => item.id))];
    const recipeRows = await loadKasirGroupComponents(supabase, groupIds);
    const componentIds = [...new Set(recipeRows.map((recipe) => recipe.component_item_id))];
    const componentUnitMap = await loadUnitOptions(supabase, componentIds);
    const componentById = new Map(recipeRows.flatMap(recipe => {
      const component = Array.isArray(recipe.component) ? recipe.component[0] : recipe.component;
      return component ? [[component.id, component] as const] : [];
    }));
    const recipeByGroup = new Map<string, ResepKomponenCheckout[]>();
    for (const groupId of groupIds) {
      const rawForGroup = recipeRows.filter((recipe) => recipe.group_item_id === groupId);
      const normalized = rawForGroup.map((recipe): ResepKomponenCheckout | null => {
        const master = componentById.get(recipe.component_item_id);
        const officialUnit = componentUnitMap.get(recipe.component_item_id)
          ?.find((unit: { unit: string; factor: number }) =>
            unit.unit.toLowerCase() === recipe.unit.toLowerCase());
        if (!master?.is_active || master.item_type === "Grup" || !officialUnit
          || Number(officialUnit.factor) !== Number(recipe.factor)) {
          return null;
        }
        return {
          component_item_id: master.id,
          item_type: master.item_type,
          qty: Number(recipe.qty),
          unit: officialUnit.unit,
          factor: Number(officialUnit.factor),
          name: master.name,
          code: master.code,
          sort_order: Number(recipe.sort_order),
        } satisfies ResepKomponenCheckout;
      });
      const groupName = pusat.get(groupId)?.nama ?? "Grup";
      if (normalized.some((component) => component == null)) {
        redirect(`${failureUrl}${encodeURIComponent(`Rincian Grup "${groupName}" rusak atau punya komponen nonaktif`)}`);
      }
      const complete = normalized.filter((component): component is ResepKomponenCheckout => component != null);
      const validation = validasiKomponenGrup(
        complete.map((component) => ({
          component_item_id: component.component_item_id,
          qty: component.qty,
          unit: component.unit,
          factor: component.factor,
        })),
        new Map(complete.map((component) => [component.component_item_id, component.item_type])),
      );
      if (validation) {
        redirect(`${failureUrl}${encodeURIComponent(`Rincian Grup "${groupName}" tidak valid: ${validation}`)}`);
      }
      recipeByGroup.set(groupId, complete);
    }

    for (const l of rows) {
      const p = l.item_id ? pusat.get(l.item_id) : undefined;
      if (!l.item_id) {
        l.item_type = "Non-Persediaan";
        l.faktor = 1;
        continue;
      }
      if (!p?.is_active) {
        redirect(`${failureUrl}${encodeURIComponent(`Barang "${l.nama}" sudah nonaktif atau tidak ditemukan`)}`);
      }
      l.nama = p.nama;
      l.item_type = p.item_type;
      l.tindakan_kategori = p.tindakan_kategori;
      if (p.item_type === "Grup") {
        l.satuan = p.unit;
        l.faktor = 1;
        l.harga = hargaCabang(hargaMap, l.item_id, p.unit, Number(p.sell_price));
        l.group_components = expandBarisGrup(
          { item_id: l.item_id, qty: Number(l.qty) },
          recipeByGroup.get(l.item_id) ?? [],
        );
        continue;
      }
      const opsi = applyHargaCabang(unitMap.get(l.item_id) ?? [], l.item_id, hargaMap);
      if (opsi.length > 0) {
        // Satuan yang dikirim klien hanya dipakai untuk MEMILIH dari daftar resmi;
        // satuan yang sudah dihapus ditolak sebelum struk dan stok berubah.
        const u = resolveSubmittedUnit(opsi, l.satuan);
        l.satuan = u.unit;
        l.faktor = u.factor;
        l.harga = u.sell_price;
      } else {
        l.satuan = p.unit;
        l.faktor = 1;
        l.harga = hargaCabang(hargaMap, l.item_id, p.unit, Number(p.sell_price));
      }
    }

    // Minimum jual ditegakkan di server juga — kalau hanya di layar, kasir bisa
    // menembusnya lewat halaman yang sudah lama terbuka atau submit langsung.
    // Dibandingkan dalam satuan dasar, karena min_sell_qty juga satuan dasar.
    const kurangMin = rows
      .map((l) => ({ l, p: l.item_id ? pusat.get(l.item_id) : undefined }))
      .filter(({ l, p }) => p && Number(p.min_sell_qty) > 0 && toBaseQty(l.qty, l.faktor ?? 1) < Number(p.min_sell_qty));
    if (kurangMin.length > 0) {
      const pesan = kurangMin.map(({ p }) => `${p!.nama} minimal ${Number(p!.min_sell_qty)}`).join(", ");
      redirect(`${failureUrl}${encodeURIComponent(`Di bawah minimum jual: ${pesan}`)}`);
    }
  }

  try {
    const performers = await validateServicePerformerRows(supabase, branchId, rows);
    rows.forEach((row, index) => { row.service_performers = performers[index]; });
  } catch (error) {
    redirect(`${failureUrl}${encodeURIComponent(error instanceof Error ? error.message : "Pelaksana jasa tidak valid")}`);
  }

  // Harga bertingkat juga dihitung ULANG di server: harga yang dikirim layar
  // tidak menentukan uang, dan kasir tidak boleh kehilangan harga grosir hanya
  // karena layarnya sudah lama terbuka saat tingkatnya baru dipasang.
  {
    const ids = rows.map((l) => l.item_id).filter((x): x is string => !!x);
    if (ids.length) {
      const { data: tierRows } = await supabase
        .from("item_price_tiers").select("item_id, min_qty, harga").in("item_id", ids);
      const perItem = new Map<string, { min_qty: number; harga: number }[]>();
      for (const t of (tierRows ?? []) as { item_id: string; min_qty: number; harga: number }[]) {
        const arr = perItem.get(t.item_id) ?? [];
        arr.push({ min_qty: Number(t.min_qty), harga: Number(t.harga) });
        perItem.set(t.item_id, arr);
      }
      for (const l of rows) {
        const tiers = l.item_id ? perItem.get(l.item_id) : undefined;
        if (!tiers?.length) continue;
        const faktor = Number(l.faktor) || 1;
        const perDasar = hargaTingkat(toBaseQty(l.item_type === "Jasa" ? rows.filter(row => row.item_id === l.item_id && row.satuan === l.satuan).reduce((sum,row) => sum + Number(row.qty),0) : l.qty, faktor), tiers, Number(l.harga) / faktor);
        const hargaTier = Math.round(perDasar * faktor);
        // Hanya menurunkan: harga khusus yang sudah diberi kasir (mis. nego) tidak
        // boleh naik lagi gara-gara tingkat harga.
        if (hargaTier < Number(l.harga)) l.harga = hargaTier;
      }
    }
  }

  // Promo dihitung ULANG di server dari master, bukan dipercaya dari keranjang:
  // layar kasir yang sudah lama terbuka bisa memegang promo yang sudah dicabut,
  // dan angka dari klien tidak boleh menentukan potongan uang.
  const kampanye = await bacaKodeKampanye(supabase, kodeMasuk);
  const kode = bacaKode(kodeMasuk, kampanye ? [kampanye] : []);
  const voucherCode = kode.voucherCode;
  const campaignCode = kode.kampanye?.code ?? null;
  const promoMaster = await loadPromoAktif(supabase, branchId, kode.promoId ? [kode.promoId] : []);
  const promoAktif = promoDenganKode(promoMaster, kode.promoId);
  // Evidence is reconstructed after official unit/branch/tier pricing, never
  // accepted from caller officialPrice/manualOverride/promo fields.
  const potonganPromo = serviceLinePromos(promoAktif, rows.map(row => ({
    ...row, officialPrice: row.harga, manualOverride: Number(row.item_discount_value) > 0,
  })));
  if (kode.kampanye) {
    const tolakKampanye = pesanKampanyeDitolak(kode.kampanye,
      promoAktif.some((p) => p.id === kode.promoId), potonganPromo.some((h) => h.promoId === kode.promoId));
    if (tolakKampanye) redirect(`${failureUrl}${encodeURIComponent(tolakKampanye)}`);
  } else {
    // Voucher milik kampanye aktif hanya berlaku lewat kode kampanyenya (keputusan pemilik 29 Okt).
    const tolakMentah = await cekVoucherLewatKampanye(supabase, voucherCode);
    if (tolakMentah) redirect(`${failureUrl}${encodeURIComponent(tolakMentah)}`);
  }
  // Promo mana yang kena di baris mana ikut disimpan ke struk (migrasi 0127) —
  // tanpa itu laporan promo cuma bisa menghitung total diskon, tidak bisa bilang
  // program mana yang menghabiskannya.
  const promoPerItem = new Map(potonganPromo.map((h) => [h.lineIndex, h.promoId]));
  for (const h of potonganPromo) {
    const baris = rows[h.lineIndex];
    if (baris) baris.promo_discount = h.potongan;
  }

  // Urutan kalkulasi (§6): diskon item → diskon transaksi + voucher → poin (lib/pos-calc — jangan diubah).
  const subtotal = posSubtotal(rows);
  const afterItems = subtotal - rows.reduce((a, l) => a + lineDiscount(l), 0);

  // voucher divalidasi server-side (persen dihitung setelah diskon item).
  // Masa berlaku ikut dicek di sini — kode yang bocor ke luar tidak boleh terus
  // dipakai hanya karena kasir masih hafal kodenya.
  let voucherVal = 0;
  if (voucherCode) {
    const { data: v } = await supabase
      .from("vouchers")
      .select("code, tipe, nilai, is_active, valid_from, valid_until, max_potongan, min_belanja, boleh_gabung_promo, customer_id, category_id")
      .eq("code", voucherCode).maybeSingle();
    const wibToday = hariIniWIB();
    // Syarat keranjang (minimal belanja & larangan gabung promo) ikut diperiksa di
    // sini, bukan cuma di layar: keranjang yang dikirim klien tidak dipercaya.
    // Voucher bersasaran diperiksa terhadap pelanggan transaksi ini — kode yang
    // bocor ke orang lain harus ditolak di server, bukan cuma disembunyikan di layar.
    const { data: custVoucher } = customerId
      ? await supabase.from("customers").select("category_id").eq("id", customerId).maybeSingle()
      : { data: null };
    const tolak = pesanVoucherDitolak((v ?? null) as VoucherRow | null, wibToday, {
      dasar: afterItems,
      adaPromoOtomatis: potonganPromo.length > 0,
      customerId,
      categoryId: custVoucher?.category_id ?? null,
    });
    if (tolak) redirect(`${failureUrl}${encodeURIComponent(tolak)}`);
    voucherVal = potonganVoucher(afterItems, v as VoucherRow);
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
        aggregateServiceLines(rows).map((l) => ({ item_id: l.item_id, qty: l.qty, harga: l.harga })),
        aturan, Number(kat.diskon_persen), infoBarang,
      );
      rupiahPerPoin = Number(kat.rupiah_per_poin);
    }
  } else if (poinReq > 0) {
    redirect(`${failureUrl}${encodeURIComponent("Pilih pelanggan dulu untuk pakai poin")}`);
  }

  poinDigunakan = Math.min(poinDigunakan, Math.floor(computeTotals(rows, diskon + diskonKategori, voucherVal, 0).total));
  const potonganPoin = poinDigunakan * RUPIAH_PER_POIN;
  // Diskon golongan digabung ke potongan tingkat transaksi bersama diskon manual
  // kasir, jadi urutan §6 (item → transaksi → poin) tetap utuh.
  const totals = computeTotals(rows, diskon + diskonKategori, voucherVal, potonganPoin);
  poinDigunakan = totals.poin; // poin efektif setelah cap (tidak melebihi sisa tagihan)
  const total = roundPosMoney(totals.total);
  const invoiceSubtotal = roundPosMoney(subtotal);
  const invoiceDiscount = posNetTotal(invoiceSubtotal, total);
  const invoiceCategoryDiscount = Math.min(roundPosMoney(diskonKategori), invoiceDiscount);
  let payment: ReturnType<typeof resolvePosPayments>;
  let quote: ReturnType<typeof quotePosMerchantFees>;
  try {
    quote = quotePosMerchantFees({ total, method: metode, payments: String(formData.get("split_payments") ?? ""), feePercent: Number(formData.get("merchant_fee_percent") ?? 0) });
    payment = resolvePosPayments({ total: quote.total, method: metode, bayar, payments: metode === "Split" ? quote.parts : [] });
  } catch (error) {
    redirect(`${failureUrl}${encodeURIComponent(error instanceof Error ? error.message : "Rincian pembayaran tidak valid")}`);
  }

  // Cabang tetap wajib punya gudang aktif untuk mencatat stok keluar. Bila stok
  // kurang, layar kasir mengingatkan tetapi owner boleh melanjutkan transaksi.
  const kebutuhanStok = kebutuhanStokCheckout(rows.map((row) => ({
    item_id: row.item_id,
    item_type: row.item_type ?? "Non-Persediaan",
    qty: Number(row.qty),
    factor: Number(row.faktor) || 1,
    group_components: row.group_components,
  })));
  const { data: wh, error: whErr } = await supabase
    .from("warehouses").select("id").eq("branch_id", branchId)
    .eq("is_active", true).order("type").limit(1).maybeSingle();
  if (whErr) redirect(`${failureUrl}${encodeURIComponent(`Gagal membaca gudang: ${whErr.message}`)}`);
  if (kebutuhanStok.length > 0 && !wh) {
    redirect(`${failureUrl}${encodeURIComponent("Cabang belum punya gudang aktif untuk memotong stok")}`);
  }
  // FIFO is the accounting HPP. items.buy_price is only the PO reference
  // price, so the cashier guard reads current warehouse layers before creating
  // any sale or issuing stock. Transaction discounts are apportioned to lines.
  // P03: a Grup line with stock components is priced against their summed FIFO cost.
  const floorRows = rows.filter(row => row.item_id && isPriceFloorGoods(row));
  if (floorRows.length > 0 && wh) {
    let lineCosts: (number | null)[];
    try {
      lineCosts = await quoteSaleLineCosts(supabase, wh.id, rows, masterBuyPrices);
    } catch {
      redirect(`${failureUrl}${encodeURIComponent("HPP aktif belum dapat dibaca lengkap. Muat ulang sebelum membayar.")}`);
    }
    const priceIssue = cashierPriceFloorIssue(rows.map(row => ({ ...row, item_type: row.item_type })), total, lineCosts);
    if (priceIssue) redirect(`${failureUrl}${encodeURIComponent(priceIssue)}`);
  }
  // Poin ikut golongan pelanggan (migrasi 0078); golongan tanpa pengaturan
  // sendiri tetap Rp1.000 = 1 poin seperti sebelumnya.
  const poinEarned = customerId ? poinDidapat(total, rupiahPerPoin) : 0;

  // Formatnya dibaca dari master penomoran; bawaannya POS-YYYYMMDD-NNNN.
  // Dua kasir yang membayar pada detik yang sama bisa memegang nomor yang sama;
  // yang kalah mengulang kepala struk dengan nomor baru (lib/simpan-bernomor),
  // bukan memperlihatkan penolakan database ke kasir.
  const { data: sale, error: saleErr, nomor: noStruk, bentrok } = await simpanBernomor<{ id: string }>(
    supabase,
    { jenis: "POS", tanggal: hariIniWIB(), table: "sales", column: "no_struk" },
    (no_struk) => supabase
      .from("sales")
      .insert({
        branch_id: branchId, customer_id: customerId, no_struk,
        subtotal: invoiceSubtotal, discount: posNetTotal(invoiceDiscount, invoiceCategoryDiscount),
        diskon_kategori: invoiceCategoryDiscount,
        total: quote.total, merchant_fee_total: quote.feeTotal, metode_bayar: payment.method, bayar: payment.bayar, kembali: payment.kembali,
        payment_plan: quote.parts,
        checkout_key: checkout.key, checkout_fingerprint: checkout.fingerprint,
        poin_earned: poinEarned, poin_digunakan: poinDigunakan, voucher_code: voucherCode,
        ...(campaignCode ? { campaign_code: campaignCode } : {}),
        cashier_id: user?.id ?? null, shift_id: shift!.id,
        salesperson_id: salespersonId, cashier_name: cashier.name,
      })
      .select("id").single(),
  );
  if (bentrok || saleErr || !sale) {
    await resumePosCheckout(supabase, user.id, checkout, "cashier", undefined, replacementId);
    const pesan = bentrok
      ? PESAN_STRUK_BENTROK
      : pesanGagalKampanye(saleErr?.message) ?? saleErr?.message ?? "Gagal simpan transaksi";
    redirect(`${failureUrl}${encodeURIComponent(pesan)}`);
  }

  // Validate every pending line snapshot before any separate stock request.
  // A rejected later service performer must not follow an earlier stock issue.
  let checkoutFailure: string | null = null;
  try {
    const pendingRows = rows.map(r => ({ r, id: randomUUID() }));
    for (const [lineIndex,{r,id:saleLineId}] of pendingRows.entries()) {
      const { data: saleItem, error: itemErr } = await supabase.from("sale_items").insert({
        id: saleLineId, sale_id: sale.id, item_id: r.item_id, nama: r.nama, qty: r.qty, harga: r.harga,
        source_position: lineIndex,
        quantity_pool_claim: linePromoApplied(r) > 0 && promoAktif.some(p =>
          p.id === promoPerItem.get(lineIndex) && p.discountMode === "quantity_pool"),
        satuan: r.satuan ?? null, faktor: r.faktor ?? 1,
        target_species: r.target_species ?? "Universal",
        service_performers: r.service_performers,
        item_discount_type: r.item_discount_type ?? null,
        item_discount_value: Math.max(0, Number(r.item_discount_value) || 0),
        // Promo hanya dicatat kalau uangnya benar-benar keluar. Diskon manual
        // kasir menang atas promo (lib/pos-calc), jadi menyimpan promo_id pada
        // baris yang potongannya nol membuat laporan promo menghitung pemakaian
        // program yang tidak pernah membayar apa pun — dan struk menamai diskon
        // kasir dengan nama promo.
        promo_id: r.item_id && linePromoApplied(r) > 0 ? (promoPerItem.get(lineIndex) ?? null) : null,
        promo_discount: linePromoApplied(r),
        hpp: r.item_id ? 0 : null,
      }).select("id").single();
      if (itemErr || !saleItem) {
        throw new Error(itemErr?.message ?? `Gagal simpan baris ${r.nama}`);
      }
    }
    for (const {r,id:saleLineId} of pendingRows) {
      const snapshots = (r.group_components ?? []).map((snapshot) => ({ ...snapshot }));
      if (snapshots.length > 0) {
        const { error: snapshotErr } = await supabase.from("sale_item_group_components").insert(
          snapshots.map((snapshot) => ({ ...snapshot, sale_item_id: saleLineId })),
        );
        if (snapshotErr) throw new Error(`Gagal simpan rincian Grup ${r.nama}: ${snapshotErr.message}`);
      }
    }
    // One DB transaction issues FIFO stock, checks each inventory line against
    // the actual cost and finalizes payment/HPP. No separate HTTP stock calls.
    if (kebutuhanStok.length > 0) {
      const { data: posted, error: postErr } = await supabase.rpc("cashier_post_stock_atomic", {
        p_sale_id: sale.id, p_warehouse_id: wh!.id,
      });
      if (postErr || posted?.sale_id !== sale.id || posted?.finalized !== true || posted?.checked !== true) {
        throw new Error(postErr?.message ? cashierPriceFloorDbMessage(postErr.message) : "Stok dan harga neto kasir belum berhasil difinalkan");
      }
    }
  } catch (error) {
    checkoutFailure = error instanceof Error ? pesanGagalKampanye(error.message) ?? error.message : "Gagal memproses stok atau rincian transaksi";
    console.error(`[checkout] gagal menyimpan ${noStruk}:`, error);
  }
  if (checkoutFailure) {
    // A failed atomic posting rolls back stock, journals, points and payment.
    // Pending sale lines/snapshots are then removed by this FK cascade.
    const { error: cleanupErr } = await supabase.from("sales").delete().eq("id", sale.id);
    if (cleanupErr) console.error(`[checkout] gagal bersihkan sales ${sale.id}:`, cleanupErr.message);
    redirect(`${failureUrl}${encodeURIComponent(checkoutFailure)}`);
  }

  // Pembayaran dan HPP diposting bersama oleh database. Struk tidak boleh
  // dinyatakan selesai jika finalisasi pembukuannya gagal.
  const { data: finalized, error: finalizationErr } = kebutuhanStok.length > 0
    ? { data: { sale_id: sale.id, finalized: true }, error: null }
    : await supabase.rpc("finalize_pos_sale", { p_sale_id: sale.id });
  if (finalizationErr || finalized?.sale_id !== sale.id || finalized?.finalized !== true) {
    await resumePosCheckout(supabase, user.id, checkout, "cashier", sale.id, replacementId);
    const { error: cleanupErr } = await supabase.from("sales").delete().eq("id", sale.id);
    if (cleanupErr) console.error(`[checkout] gagal bersihkan sales ${sale.id}:`, cleanupErr.message);
    redirect(`${failureUrl}${encodeURIComponent(pesanGagalKampanye(finalizationErr?.message) ?? finalizationErr?.message ?? "Pembukuan transaksi belum selesai. Coba kembali.")}`);
  }

  // Saldo/ledger poin disimpan atomik oleh finalizer; golongan mengikuti penjualan selesai.
  if (customerId) await recomputeCustomerTier(supabase, customerId);

  // Addendum §8: progres quest staff (best-effort, tidak mem-block checkout).
  if (user?.id) {
    await processQuestProgress(supabase, {
      saleId: sale.id,
    });
  }

  // Auto-cetak struk (fire window.print di halaman struk) — semua metode bayar.
  const checkoutKey = String(formData.get("checkout_key") ?? "");
  redirect(`/kasir/struk/${sale!.id}?print=1${checkoutKey ? `&draft_done=${encodeURIComponent(checkoutKey)}` : ""}`);
}
