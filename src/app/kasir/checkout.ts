"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { stockOut } from "@/lib/inventory";
import { loadHargaCabang, hargaCabang, applyHargaCabang } from "@/lib/harga-cabang";
import { loadUnitOptions, pickUnit, toBaseQty } from "@/lib/satuan";
import { computeTotals, lineDiscount, linePromoApplied } from "@/lib/pos-calc";
import { processQuestProgress } from "@/lib/quest-hook";
import { recomputeCustomerTier } from "@/lib/customer-tier";
import { pesanVoucherDitolak, potonganVoucher, normalizeKode, type VoucherRow } from "@/lib/voucher";
import {
  diskonGolonganKeranjang, loadAturanDiskon, loadInfoBarang, poinDidapat,
} from "@/lib/harga-golongan";
import { hitungPromoKeranjang, loadPromoAktif } from "@/lib/promo-hitung";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import { hargaTingkat } from "@/lib/harga-tingkat";
import { cekPeriode } from "@/lib/jurnal-guard";
import {
  expandBarisGrup,
  kebutuhanStokCheckout,
  validasiKomponenGrup,
  type JenisKomponen,
  type ResepKomponenCheckout,
  type SnapshotKomponenGrup,
} from "@/lib/grup-barang";

type CartLine = {
  item_id: string; nama: string; qty: number; harga: number; target_species?: string;
  item_discount_type?: "nominal" | "percent" | null; item_discount_value?: number | null;
  promo_discount?: number | null;   // diisi server dari master, bukan dari klien
  satuan?: string; faktor?: number; // ditetapkan ulang dari master di bawah
  item_type?: JenisKomponen;         // ditetapkan ulang dari master di bawah
  group_components?: SnapshotKomponenGrup[];
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

  // Struk boleh tersimpan hanya kalau jurnalnya juga bisa. Kalau periodenya terkunci,
  // penjualan akan tercatat di kasir tapi hilang dari buku besar tanpa peringatan.
  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) redirect(`/kasir?error=${encodeURIComponent(pesanPeriode)}`);

  // Harga ditetapkan ULANG di server: harga jual sekarang bisa beda per cabang
  // (migrasi 0073), jadi layar kasir yang sudah lama terbuka tidak boleh menentukan
  // harga sendiri. Baris tanpa item_id (ketikan manual) tetap pakai harga yang diisi.
  const cartIds = [...new Set(rows.map((l) => l.item_id).filter(Boolean))];
  const namaStok = new Map<string, string>();
  if (cartIds.length > 0) {
    const [{ data: itemsHarga }, hargaMap, unitMap] = await Promise.all([
      supabase.from("items").select("id, nama:name, unit, item_type, sell_price, min_sell_qty, is_active").in("id", cartIds),
      loadHargaCabang(supabase, branchId, cartIds),
      // Faktor satuan WAJIB dari master: faktor palsu dari klien = stok terpotong
      // lebih sedikit daripada barang yang benar-benar keluar dari rak.
      loadUnitOptions(supabase, cartIds),
    ]);
    type ItemHarga = {
      id: string; nama: string; unit: string; item_type: JenisKomponen;
      sell_price: number; min_sell_qty: number; is_active: boolean;
    };
    const pusat = new Map(
      ((itemsHarga ?? []) as ItemHarga[])
        .map((i) => [i.id, i]),
    );
    for (const item of pusat.values()) namaStok.set(item.id, item.nama);

    const groupIds = [...new Set(rows
      .map((line) => line.item_id ? pusat.get(line.item_id) : undefined)
      .filter((item): item is ItemHarga => item?.item_type === "Grup")
      .map((item) => item.id))];
    type RecipeRaw = {
      group_item_id: string; component_item_id: string; qty: number;
      unit: string; factor: number; sort_order: number;
    };
    const { data: recipeRaw, error: recipeErr } = groupIds.length
      ? await supabase.from("item_group_components")
        .select("group_item_id, component_item_id, qty, unit, factor, sort_order")
        .in("group_item_id", groupIds).order("sort_order")
      : { data: [], error: null };
    if (recipeErr) redirect(`/kasir?error=${encodeURIComponent(`Gagal membaca rincian Grup: ${recipeErr.message}`)}`);

    const recipeRows = (recipeRaw ?? []) as RecipeRaw[];
    const componentIds = [...new Set(recipeRows.map((recipe) => recipe.component_item_id))];
    const [{ data: componentItemsRaw, error: componentErr }, componentUnitMap] = componentIds.length
      ? await Promise.all([
        supabase.from("items").select("id, code, name, item_type, is_active").in("id", componentIds),
        loadUnitOptions(supabase, componentIds),
      ])
      : [{ data: [], error: null }, new Map()];
    if (componentErr) redirect(`/kasir?error=${encodeURIComponent(`Gagal membaca komponen Grup: ${componentErr.message}`)}`);

    type ComponentMaster = {
      id: string; code: string | null; name: string;
      item_type: JenisKomponen; is_active: boolean;
    };
    const componentById = new Map(
      ((componentItemsRaw ?? []) as ComponentMaster[]).map((component) => [component.id, component]),
    );
    for (const component of componentById.values()) namaStok.set(component.id, component.name);

    const recipeByGroup = new Map<string, ResepKomponenCheckout[]>();
    for (const groupId of groupIds) {
      const rawForGroup = recipeRows.filter((recipe) => recipe.group_item_id === groupId);
      const normalized = rawForGroup.map((recipe) => {
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
        redirect(`/kasir?error=${encodeURIComponent(`Rincian Grup "${groupName}" rusak atau punya komponen nonaktif`)}`);
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
        redirect(`/kasir?error=${encodeURIComponent(`Rincian Grup "${groupName}" tidak valid: ${validation}`)}`);
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
        redirect(`/kasir?error=${encodeURIComponent(`Barang "${l.nama}" sudah nonaktif atau tidak ditemukan`)}`);
      }
      l.nama = p.nama;
      l.item_type = p.item_type;
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
        // kalau tidak dikenal, pickUnit jatuh ke satuan dasar.
        const u = pickUnit(opsi, l.satuan);
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
      redirect(`/kasir?error=${encodeURIComponent(`Di bawah minimum jual: ${pesan}`)}`);
    }
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
        const perDasar = hargaTingkat(toBaseQty(l.qty, faktor), tiers, Number(l.harga) / faktor);
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
  const promoAktif = await loadPromoAktif(supabase, branchId);
  const potonganPromo = hitungPromoKeranjang(promoAktif, rows);
  // Promo mana yang kena di baris mana ikut disimpan ke struk (migrasi 0127) —
  // tanpa itu laporan promo cuma bisa menghitung total diskon, tidak bisa bilang
  // program mana yang menghabiskannya.
  const promoPerItem = new Map(potonganPromo.map((h) => [h.item_id, h.promoId]));
  for (const h of potonganPromo) {
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
    if (tolak) redirect(`/kasir?error=${encodeURIComponent(tolak)}`);
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

  // Preflight seluruh kebutuhan dalam satuan dasar SEBELUM sales dibuat. Barang
  // langsung dan komponen dari beberapa Grup digabung agar item sama tidak lolos
  // karena diperiksa per baris.
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
  if (whErr) redirect(`/kasir?error=${encodeURIComponent(`Gagal membaca gudang: ${whErr.message}`)}`);
  if (kebutuhanStok.length > 0 && !wh) {
    redirect(`/kasir?error=${encodeURIComponent("Cabang belum punya gudang aktif untuk memotong stok")}`);
  }
  if (wh && kebutuhanStok.length > 0) {
    const { data: stockRows, error: stockErr } = await supabase.from("stock")
      .select("item_id, qty").eq("warehouse_id", wh.id)
      .in("item_id", kebutuhanStok.map((row) => row.item_id));
    if (stockErr) redirect(`/kasir?error=${encodeURIComponent(`Gagal membaca stok: ${stockErr.message}`)}`);
    const available = new Map(
      ((stockRows ?? []) as { item_id: string; qty: number }[])
        .map((stock) => [stock.item_id, Number(stock.qty)]),
    );
    const shortages = kebutuhanStok.filter((need) =>
      (available.get(need.item_id) ?? 0) + Number.EPSILON < need.qty_dasar,
    );
    if (shortages.length > 0) {
      const detail = shortages.map((need) => {
        const stock = available.get(need.item_id) ?? 0;
        return `${namaStok.get(need.item_id) ?? need.item_id} butuh ${need.qty_dasar}, tersedia ${stock}`;
      }).join("; ");
      redirect(`/kasir?error=${encodeURIComponent(`Stok tidak cukup: ${detail}`)}`);
    }
  }

  // Formatnya dibaca dari master penomoran; bawaannya POS-YYYYMMDD-NNNN.
  const { nomor: noStruk } = await nomorBerikutnya(supabase, "POS", hariIniWIB(), {
    table: "sales", column: "no_struk",
  });

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

  // Stok dipotong DULU per baris, lalu sale_item + snapshot disimpan. HPP Grup
  // adalah total cost FIFO komponen Persediaan, bukan buy_price induk virtual.
  let hppFifo = 0;
  let checkoutFailure: string | null = null;
  try {
    for (const r of rows) {
      let lineHpp = 0;
      const snapshots = (r.group_components ?? []).map((snapshot) => ({ ...snapshot }));

      if (wh && r.item_type === "Persediaan" && r.item_id) {
        const { cost } = await stockOut(supabase, {
          warehouseId: wh.id, itemId: r.item_id, qty: toBaseQty(r.qty, r.faktor ?? 1),
          source: "sale", ref: noStruk,
        });
        lineHpp += cost;
      }
      if (wh && r.item_type === "Grup") {
        for (const snapshot of snapshots) {
          if (snapshot.item_type !== "Persediaan") continue;
          const { cost } = await stockOut(supabase, {
            warehouseId: wh.id,
            itemId: snapshot.component_item_id,
            qty: snapshot.total_base_qty,
            source: "sale-group",
            ref: noStruk,
          });
          snapshot.hpp = cost;
          lineHpp += cost;
        }
      }

      const { data: saleItem, error: itemErr } = await supabase.from("sale_items").insert({
        sale_id: sale.id, item_id: r.item_id, nama: r.nama, qty: r.qty, harga: r.harga,
        satuan: r.satuan ?? null, faktor: r.faktor ?? 1,
        target_species: r.target_species ?? "Universal",
        item_discount_type: r.item_discount_type ?? null,
        item_discount_value: Math.max(0, Number(r.item_discount_value) || 0),
        promo_id: r.item_id ? (promoPerItem.get(r.item_id) ?? null) : null,
        promo_discount: linePromoApplied(r),
        hpp: r.item_id ? lineHpp : null,
      }).select("id").single();
      if (itemErr || !saleItem) {
        throw new Error(itemErr?.message ?? `Gagal simpan baris ${r.nama}`);
      }

      if (snapshots.length > 0) {
        const { error: snapshotErr } = await supabase.from("sale_item_group_components").insert(
          snapshots.map((snapshot) => ({ ...snapshot, sale_item_id: saleItem.id })),
        );
        if (snapshotErr) throw new Error(`Gagal simpan rincian Grup ${r.nama}: ${snapshotErr.message}`);
      }
      hppFifo += lineHpp;
    }
  } catch (error) {
    checkoutFailure = error instanceof Error ? error.message : "Gagal memproses stok atau rincian transaksi";
    console.error(`[checkout] gagal menyimpan ${noStruk}:`, error);
  }
  if (checkoutFailure) {
    // Sale item/snapshot ikut terhapus lewat FK cascade. Mutasi stockOut masih JS
    // nontransaksional; kegagalannya tidak disamarkan sebagai transaksi sukses.
    const { error: cleanupErr } = await supabase.from("sales").delete().eq("id", sale.id);
    if (cleanupErr) console.error(`[checkout] gagal bersihkan sales ${sale.id}:`, cleanupErr.message);
    redirect(`/kasir?error=${encodeURIComponent(checkoutFailure)}`);
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
  const kasCode = await kodeAkunBayar(supabase, metode, branchId);
  const { dpp, ppn } = splitPpnInklusif(total, await getPajakSettings(supabase));
  const todayIso = hariIniWIB();
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
