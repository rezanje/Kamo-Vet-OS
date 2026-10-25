import { loadSaleReplacement, saleReplacementDraft } from "@/lib/sale-replacement";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { promoActiveFor, type PromoRow as PromoFull } from "@/lib/promo";
import { voucherBerlaku, type VoucherRow as VoucherFull } from "@/lib/voucher";
import type { PromoHitung } from "@/lib/promo-hitung";
import { type AturanDiskon } from "@/lib/harga-golongan";
import { hargaCabang, applyHargaCabang } from "@/lib/harga-cabang";
import { loadUnitOptions } from "@/lib/satuan";
import { stokEfektifGrup } from "@/lib/grup-barang";
import { KasirClient, type ItemRow, type CustRow, type VoucherRow, type PromoRow } from "./KasirClient";
import { hariIniWIB } from "@/lib/tanggal";
import { loadServiceStaff, loggedInCashier } from "@/lib/service-performers-server";
import { loadKasirItems, loadKasirCatalogDetails, loadKasirGroupComponents } from "@/lib/kasir-catalog";
import { loadBranchGroomingPolicy } from "@/lib/service-performers-server";
import { isGroomingService } from "@/lib/grooming-requirements";
import { isCompletedSale } from "@/lib/sale-payment-reporting";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

export default async function KasirPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; replace_sale?: string; completed_sale_id?: string; draft_used?: string }>;
}) {
  const { error, replace_sale, completed_sale_id: completedSaleId, draft_used: usedDraftKey } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // hard gate: tanpa shift terbuka tidak boleh masuk kasir.
  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) {
    if (replace_sale) redirect(`/penjualan/${encodeURIComponent(replace_sale)}?error=${encodeURIComponent("Buka shift kasir pada cabang sumber, lalu pilih Siapkan transaksi pengganti.")}`);
    redirect("/kasir/mulai");
  }
  const replacement = await loadSaleReplacement(supabase, replace_sale);
  if (replacement && (replacement.channel || replacement.branch_id !== shift.branch_id)) {
    redirect(`/penjualan/${replacement.id}?error=${encodeURIComponent("Gunakan shift pada cabang penjualan sumber untuk menyiapkan pengganti.")}`);
  }
  const replacementDraft = replacement ? saleReplacementDraft(replacement) : undefined;

  const [itemsRaw, { data: customers }, { data: salesAgg }, { data: invAgg }, { data: vouchers }, { data: promos }] = await Promise.all([
    loadKasirItems(supabase),
    // Golongan ikut dibawa: diskon & rumus poinnya dipakai layar kasir untuk
    // MENAMPILKAN total yang sama dengan yang nanti dihitung server saat bayar.
    supabase.from("customers")
      .select("id, name, phone, points, tier, kategori, category_id, customer_categories(nama, diskon_persen, rupiah_per_poin, is_active), customer_review_statuses(nama, warna, nada)")
      .order("name"),
    supabase.from("sales").select("customer_id, total, payment_plan, payments_finalized_at, voided_at"),
    supabase
      .from("invoices")
      .select("total, visits!inner(customer_id)")
      .eq("paid_status", "Lunas")
      .is("voided_at", null),
    supabase.from("vouchers")
      .select("code, tipe, nilai, is_active, valid_from, valid_until, max_potongan, min_belanja, boleh_gabung_promo, customer_id, category_id")
      .eq("is_active", true),
    supabase.from("promos")
      .select("id, name, promo_type, rule, is_active, branch_ids, valid_from, valid_until, min_qty, max_qty, kelipatan, auto_apply, discount_type, discount_value")
      .eq("is_active", true),
  ]);
  const groomingPolicy = itemsRaw.some(item => isGroomingService(item.item_type, item.tindakan_kategori))
    ? await loadBranchGroomingPolicy(supabase, shift.branch_id) : { applies: false, doctorRequired: false };

  // Addendum: promo yang aktif hari ini untuk cabang shift (branch + tanggal).
  const wibToday = hariIniWIB();
  if (replacement && replacement.sale_items.some(row => !itemsRaw.some(item => item.id === row.item_id))) {
    redirect(`/penjualan/${replacement.id}?error=${encodeURIComponent("Sebagian barang sumber tidak tersedia di katalog aktif. Aktifkan atau tentukan barang pengganti sebelum membuat transaksi baru.")}`);
  }
  const promosActive = ((promos ?? []) as unknown as PromoFull[]).filter((p) => promoActiveFor(p, shift.branch_id, wibToday));

  // Barang yang kena tiap promo (migrasi 0079). Promo tanpa baris di sini
  // berlaku untuk semua barang — lihat lib/promo-hitung.
  const { data: promoItemRows } = promosActive.length
    ? await supabase.from("promo_items").select("promo_id, item_id").in("promo_id", promosActive.map((p) => p.id))
    : { data: [] };
  const itemsPerPromo = new Map<string, string[]>();
  for (const r of (promoItemRows ?? []) as { promo_id: string; item_id: string }[]) {
    itemsPerPromo.set(r.promo_id, [...(itemsPerPromo.get(r.promo_id) ?? []), r.item_id]);
  }
  const promoHitung: PromoHitung[] = promosActive.map((p) => ({
    id: p.id, name: p.name,
    itemIds: itemsPerPromo.get(p.id) ?? [],
    minQty: p.min_qty == null ? null : Number(p.min_qty),
    maxQty: p.max_qty == null ? null : Number(p.max_qty),
    kelipatan: !!p.kelipatan,
    autoApply: !!p.auto_apply,
    discountType: p.discount_type,
    discountValue: p.discount_value == null ? null : Number(p.discount_value),
    minSubtotal: p.rule?.min_subtotal ?? null,
  }));

  // Voucher yang sudah lewat/belum mulai tidak dikirim ke layar: kalau dikirim,
  // kasir melihat potongan yang nanti ditolak server saat tombol bayar ditekan.
  const vouchersAktif = ((vouchers ?? []) as unknown as VoucherFull[]).filter((v) => voucherBerlaku(v, wibToday));

  // stok di gudang pertama cabang shift (tampilan stok toko).
  const { data: wh, error: warehouseError } = await supabase
    .from("warehouses").select("id").eq("branch_id", shift.branch_id).eq("is_active", true).order("type").limit(1).maybeSingle();
  if (warehouseError) throw new Error("Gudang kasir belum dapat dimuat. Coba muat ulang.");
  const details = await loadKasirCatalogDetails(supabase, shift.branch_id, wh?.id ?? null);
  const stockMap: Record<string, number> = {};
  for (const row of details.stock) stockMap[row.item_id] = Number(row.qty);

  // Ringkasan transaksi per pelanggan (petshop sales + klinik invoices lunas,
  // semua waktu) — sama pola dengan header detail owner di antrian.
  const trxCount: Record<string, number> = {};
  const trxSum: Record<string, number> = {};
  for (const s of (salesAgg ?? []).filter(isCompletedSale) as { customer_id: string | null; total: number }[]) {
    if (!s.customer_id) continue;
    trxCount[s.customer_id] = (trxCount[s.customer_id] ?? 0) + 1;
    trxSum[s.customer_id] = (trxSum[s.customer_id] ?? 0) + Number(s.total || 0);
  }
  for (const iv of (invAgg ?? []) as { total: number; visits: Rel<{ customer_id: string | null }> }[]) {
    const custId = one(iv.visits)?.customer_id;
    if (!custId) continue;
    trxCount[custId] = (trxCount[custId] ?? 0) + 1;
    trxSum[custId] = (trxSum[custId] ?? 0) + Number(iv.total || 0);
  }

  // Harga jual bisa beda per cabang (migrasi 0073) — dipakai harga cabang shift ini.
  const harga = new Map(details.prices.map(row => [`${row.item_id}|${row.unit}`, Number(row.sell_price)]));
  // Nama barang substitusi diambil dari daftar yang sama — tidak perlu query lagi.
  const namaById = new Map(itemsRaw.map((i) => [i.id, i.name]));

  // Satuan berjenjang (dus/renteng/pcs) ikut dikirim ke layar. Sebelum ini layar
  // kasir sama sekali tidak membaca item_units, jadi satuan yang sudah dibuat di
  // master tidak bisa dipilih saat jualan (dilaporkan tim 2026-08-11).
  const unitMap = await loadUnitOptions(supabase, itemsRaw.map((i) => i.id));

  // Grup tidak punya stok sendiri. Stok jualnya = jumlah paket paling kecil yang
  // masih bisa dirakit dari seluruh komponen Persediaan di gudang shift.
  const groupIds = itemsRaw.filter((i) => i.item_type === "Grup").map((i) => i.id);
  const groupComponentRows = await loadKasirGroupComponents(supabase, groupIds);
  const groupMap = new Map<string, ItemRow["groupComponents"]>();
  for (const row of groupComponentRows) {
    const component = one(row.component);
    if (!component || component.item_type === "Grup") continue;
    const current = groupMap.get(row.group_item_id) ?? [];
    current.push({
      itemId: component.id,
      code: component.code,
      name: component.name,
      itemType: component.item_type,
      qty: Number(row.qty),
      unit: row.unit,
      factor: Number(row.factor),
    });
    groupMap.set(row.group_item_id, current);
  }

  // Harga bertingkat per jumlah beli (meeting 14 Agustus) — dikirim bersama
  // barangnya supaya harga di keranjang ikut turun begitu qty-nya cukup.
  const tierMap = new Map<string, { min_qty: number; harga: number }[]>();
  for (const t of details.tiers) {
    const arr = tierMap.get(t.item_id) ?? [];
    arr.push({ min_qty: Number(t.min_qty), harga: Number(t.harga) });
    tierMap.set(t.item_id, arr);
  }

  const itemRows: ItemRow[] = itemsRaw.map((i) => {
    const satuan = applyHargaCabang(unitMap.get(i.id) ?? [], i.id, harga);
    const groupComponents = groupMap.get(i.id) ?? [];
    const groupHasInventory = groupComponents.some((component) => component.itemType === "Persediaan");
    const groupStock = i.item_type === "Grup" && groupHasInventory
      ? stokEfektifGrup(groupComponents.map((component) => ({
        item_id: component.itemId,
        qty_per_group: component.qty * component.factor,
        item_type: component.itemType,
      })), new Map(Object.entries(stockMap)))
      : null;
    return {
      id: i.id, code: i.code, name: i.name,
      itemType: i.item_type,
      tindakanKategori: i.tindakan_kategori,
      harga: hargaCabang(harga, i.id, i.unit, Number(i.sell_price)),
      kategori: one(i.item_categories)?.name ?? "Lainnya",
      stok: i.item_type === "Grup" ? groupStock : stockMap[i.id] ?? 0,
      groupComponents: i.item_type === "Grup" ? groupComponents : undefined,
      minJual: Number(i.min_sell_qty) || 0,
      diskonDefault: Number(i.default_discount) || 0,
      substitusi: i.substitute_item_id ? namaById.get(i.substitute_item_id) ?? null : null,
      tiers: tierMap.get(i.id) ?? [],
      // Hanya kirim kalau benar-benar berjenjang — barang bersatuan tunggal tidak
      // perlu dropdown yang isinya satu pilihan.
      satuan: i.item_type !== "Grup" && satuan.length > 1 ? satuan : undefined,
    };
  });

  const salespeople = await loadServiceStaff(supabase, shift.branch_id);

  type CustRaw = {
    id: string; name: string; phone: string; points: number; tier: string | null; kategori: string;
    category_id: string | null;
    customer_categories: Rel<{ nama: string; diskon_persen: number; rupiah_per_poin: number; is_active: boolean }>;
    customer_review_statuses: Rel<{ nama: string; warna: string; nada: string }>;
  };
  const custRows: CustRow[] = ((customers ?? []) as unknown as CustRaw[]).map((c) => {
    const gol = one(c.customer_categories);
    return {
      id: c.id, name: c.name, phone: c.phone, points: c.points, tier: c.tier,
      // Nama golongan dari master; kolom teks lama dipakai kalau belum dipetakan.
      kategori: gol?.nama ?? c.kategori,
      // Golongan nonaktif tidak memberi diskon — sama aturannya dengan server.
      diskonPersen: gol?.is_active ? Number(gol.diskon_persen) : 0,
      rupiahPerPoin: gol?.is_active ? Number(gol.rupiah_per_poin) : undefined,
      golonganId: gol?.is_active ? c.category_id : null,
      trx: trxCount[c.id] ?? 0, belanja: trxSum[c.id] ?? 0,
      // Status ulasan ikut dibawa supaya kasir tahu siapa yang dia layani —
      // yang bernada negatif ditandai jelas begitu pelanggannya dipilih.
      ulasan: one(c.customer_review_statuses) ?? null,
    };
  });

  // Pengecualian diskon per produk/kategori (0082) + kategori tiap barang.
  // Dikirim ke layar supaya angka yang dilihat kasir sama dengan yang nanti
  // dihitung server saat bayar — bukan supaya klien yang menentukan diskonnya.
  const infoBarang = new Map(itemsRaw.map(item => [item.id, {
    item_id: item.id, category_id: item.category_id,
    parent_category_id: one(item.item_categories)?.parent_id ?? null,
  }]));
  const aturanPerGolongan: Record<string, AturanDiskon[]> = {};
  for (const a of details.discounts) {
    (aturanPerGolongan[a.customer_category_id] ??= []).push({
      item_id: a.item_id, item_category_id: a.item_category_id, diskon_persen: Number(a.diskon_persen),
    });
  }

  const cashier = (
    <KasirClient
        groomingDoctorRequired={groomingPolicy.doctorRequired}
        groomingApplies={groomingPolicy.applies}
      key={`${shift.id}:${replacement?.id ?? ""}`}
      replacementDraft={replacementDraft}
      replacementId={replacement?.id}
      draftContext={`${user.id}:${shift.branch_id}:${shift.id}`}
      shiftId={shift.id}
      branchName={shift.branchName}
      items={itemRows}
      customers={custRows}
      vouchers={vouchersAktif as unknown as VoucherRow[]}
      hariIni={wibToday}
      promos={promosActive as unknown as PromoRow[]}
      promoHitung={promoHitung}
      aturanDiskon={aturanPerGolongan}
      infoBarang={Object.fromEntries(infoBarang)}
      cashierName={(await loggedInCashier(supabase, user.id, shift.branch_id)).name}
      salespeople={salespeople}
      error={error}
    />
  );
  if (!completedSaleId || !usedDraftKey) return cashier;
  return (
    <>
      <div className="p2ban">
        <Link href={`/kasir/struk/${encodeURIComponent(completedSaleId)}?draft_done=${encodeURIComponent(usedDraftKey)}`}>
          Lihat struk &amp; mulai transaksi baru
        </Link>
      </div>
      {cashier}
    </>
  );
}
