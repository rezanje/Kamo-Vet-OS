"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";
import { stockOut } from "@/lib/inventory";
import { loadUnitOptions, pickUnit, toBaseQty } from "@/lib/satuan";
import { loadHargaCabang, hargaCabang } from "@/lib/harga-cabang";
import {
  diskonGolonganKeranjang, loadAturanDiskon, loadInfoBarang, poinDidapat,
} from "@/lib/harga-golongan";
import { hitungPromoKeranjang, loadPromoAktif, totalPotonganPromo } from "@/lib/promo-hitung";
import { formatNomor, urutanBerikutnya } from "@/lib/no-dokumen";

type CartLine = {
  item_id: string | null; nama: string; qty: number; harga: number; target_species: string;
  satuan?: string | null; faktor?: number;
};


export async function checkoutSale(formData: FormData) {
  const supabase = await createClient();

  const branchId = String(formData.get("branchId") ?? "");
  const customerId = String(formData.get("customerId") ?? "") || null;
  const petId = String(formData.get("petId") ?? "") || null;
  const metode = String(formData.get("metode") ?? "Tunai");
  const discount = Number(formData.get("discount")) || 0;
  const bayar = Number(formData.get("bayar")) || 0;

  if (!branchId) redirect(`/pos/transaksi?error=${encodeURIComponent("Pilih cabang dulu")}`);

  let cart: CartLine[] = [];
  try {
    cart = JSON.parse(String(formData.get("cart") ?? "[]"));
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
  const [unitOpts, hargaMap] = await Promise.all([
    loadUnitOptions(supabase, cartIds),
    loadHargaCabang(supabase, branchId, cartIds),
  ]);
  // Harga juga diambil ulang dari master + pengecualian cabang: keranjang cuma
  // menentukan barang & satuan, tidak boleh menentukan harganya sendiri.
  const rows = rawRows.map((l) => {
    const opts = l.item_id ? unitOpts.get(l.item_id) : undefined;
    const u = opts ? pickUnit(opts, l.satuan) : null;
    return {
      ...l,
      satuan: u?.unit ?? l.satuan ?? null,
      faktor: u?.factor ?? 1,
      harga: l.item_id && u ? hargaCabang(hargaMap, l.item_id, u.unit, u.sell_price) : l.harga,
    };
  });

  const subtotal = rows.reduce((a, l) => a + l.qty * l.harga, 0);

  // Promo otomatis (migrasi 0079) — dihitung dari master, aturannya sama persis
  // dengan layar kasir. Sengaja dipasang di KEDUA jalur POS: diskon golongan
  // dulu sempat hanya jalan di sini dan tidak di /kasir, dan selisih diam-diam
  // antara dua layar yang sama-sama menagih uang itu mahal ketahuannya.
  const promoAktif = await loadPromoAktif(supabase, branchId);
  const rincianPromo = hitungPromoKeranjang(
    promoAktif, rows.map((l) => ({ item_id: l.item_id ?? "", qty: l.qty, harga: l.harga })),
  );
  const potonganPromo = totalPotonganPromo(rincianPromo);
  // Rinciannya ikut disimpan ke baris struk (migrasi 0127) supaya laporan promo
  // bisa menyebut program mana yang menghabiskan uang, bukan cuma totalnya.
  const promoPerItem = new Map(rincianPromo.map((h) => [h.item_id, h]));

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
        rows.map((l) => ({ item_id: l.item_id ?? "", qty: l.qty, harga: l.harga })),
        aturan, Number(kat.diskon_persen), infoBarang,
      );
      rupiahPerPoin = Number(kat.rupiah_per_poin);
    }
  }

  const total = Math.max(0, subtotal - potonganPromo - diskonKategori - discount);
  const kembali = Math.max(0, bayar - total);

  const { data: { user } } = await supabase.auth.getUser();

  // §2.1: tautkan ke shift kasir yang sedang terbuka (kalau ada) untuk rekonsiliasi kas.
  const { data: openShift } = await supabase
    .from("cashier_shifts").select("id")
    .eq("branch_id", branchId).eq("opened_by", user?.id ?? "").eq("status", "open")
    // Satu orang boleh punya shift petshop DAN klinik terbuka bersamaan (index unik
    // per jenis). Tanpa saringan ini kueri mengembalikan dua baris, maybeSingle gagal,
    // dan penjualan tersimpan dengan shift_id kosong — uangnya masuk laci tapi tidak
    // pernah ikut dihitung saat tutup shift, jadi selisih kurang palsu.
    .eq("shift_type", "petshop").maybeSingle();

  const now = new Date();
  const prefix = `POS-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const seqStruk = await urutanBerikutnya(supabase, {
    table: "sales", column: "no_struk", prefix: `${prefix}-`, pad: 4,
  });
  const noStruk = formatNomor(`${prefix}-`, seqStruk, 4);

  // Poin ikut golongan pelanggan (migrasi 0078) — rumus sama dengan layar kasir.
  const poin = customerId ? poinDidapat(total, rupiahPerPoin) : 0;

  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .insert({
      branch_id: branchId, customer_id: customerId, pet_id: petId, no_struk: noStruk,
      // Potongan promo digabung ke `discount` (potongan tingkat transaksi) —
      // `diskon_kategori` sengaja tetap berisi diskon golongan saja supaya
      // laporan yang memisahkan keduanya tidak berubah artinya.
      subtotal, discount: discount + potonganPromo, diskon_kategori: diskonKategori,
      total, metode_bayar: metode, bayar, kembali, poin_earned: poin,
      cashier_id: user?.id ?? null, shift_id: openShift?.id ?? null,
    })
    .select("id").single();
  if (saleErr || !sale) redirect(`/pos/transaksi?error=${encodeURIComponent(saleErr?.message ?? "Gagal simpan transaksi")}`);

  const { error: itErr } = await supabase.from("sale_items").insert(
    rows.map((l) => ({
      sale_id: sale!.id, item_id: l.item_id, nama: l.nama, qty: l.qty, harga: l.harga,
      target_species: l.target_species, satuan: l.satuan, faktor: l.faktor,
      promo_id: l.item_id ? (promoPerItem.get(l.item_id)?.promoId ?? null) : null,
      promo_discount: l.item_id ? (promoPerItem.get(l.item_id)?.potongan ?? 0) : 0,
    }))
  );
  if (itErr) redirect(`/pos/transaksi?error=${encodeURIComponent(itErr.message)}`);

  // Stok keluar via FIFO — total cost jadi HPP riil (PRD §10.2).
  let hppFifo = 0;
  const { data: wh } = await supabase
    .from("warehouses").select("id").eq("branch_id", branchId).eq("is_active", true).order("type").limit(1).maybeSingle();
  if (wh) {
    for (const r of rows) {
      if (!r.item_id) continue;
      // Stok disimpan dalam satuan dasar: jual 1 box = keluar 12 pcs.
      const { cost } = await stockOut(supabase, {
        warehouseId: wh.id, itemId: r.item_id, qty: toBaseQty(r.qty, r.faktor), source: "sale", ref: noStruk,
      });
      hppFifo += cost;
    }
  }

  // §1.4: poin masuk ledger + saldo berjalan, total_spending pelanggan naik.
  if (customerId && poin > 0) {
    const { data: cust } = await supabase.from("customers").select("points, total_spending").eq("id", customerId).single();
    const saldo = (cust?.points ?? 0) + poin;
    await supabase.from("customers").update({ points: saldo, total_spending: (Number(cust?.total_spending) || 0) + total }).eq("id", customerId);
    await supabase.from("point_ledger").insert({ customer_id: customerId, delta: poin, saldo, ref: noStruk, description: `Transaksi ${noStruk}` });
  }

  // Accounting: Dr Kas/Bank; Cr Pendapatan (+ PPN Keluaran bila Mode PKP aktif).
  // Harga POS = PPN-inklusif (standar retail).
  const kasCode = await kodeAkunBayar(supabase, metode, branchId);
  const { dpp: dppPos, ppn: ppnPos } = splitPpnInklusif(total, await getPajakSettings(supabase));
  const todayIso = hariIniWIB();
  await postJournal(supabase, {
    tanggal: todayIso,
    deskripsi: `Penjualan POS ${noStruk}`,
    source: "sale",
    sourceRef: noStruk,
    branchId,
    lines: [
      { code: kasCode, debit: total, credit: 0 },
      { code: "4101", debit: 0, credit: dppPos },
      ...(ppnPos > 0 ? [{ code: "2201", debit: 0, credit: ppnPos }] : []),
    ],
  });

  // HPP = cost FIFO riil dari layer yang terkonsumsi (bukan buy_price statis).
  if (hppFifo > 0) {
    await postJournal(supabase, {
      tanggal: todayIso,
      deskripsi: `HPP penjualan ${noStruk}`,
      source: "sale-hpp",
      sourceRef: noStruk,
      branchId,
      lines: [
        { code: "5101", debit: hppFifo, credit: 0 },
        { code: "1301", debit: 0, credit: hppFifo },
      ],
    });
  }

  redirect(`/pos/struk/${sale!.id}`);
}
