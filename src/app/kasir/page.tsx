import { loadSaleReplacement, saleReplacementDraft } from "@/lib/sale-replacement";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { promoActiveFor, type PromoRow as PromoFull } from "@/lib/promo";
import { voucherBerlaku, type VoucherRow as VoucherFull } from "@/lib/voucher";
import { promoPricingRule, validatePackageDiscount, type PromoHitung } from "@/lib/promo-hitung";
import { type AturanDiskon } from "@/lib/harga-golongan";
import { hargaCabang, applyHargaCabang } from "@/lib/harga-cabang";
import { loadUnitOptions } from "@/lib/satuan";
import { stokEfektifGrup } from "@/lib/grup-barang";
import { KasirClient, type ItemRow, type VoucherRow, type PromoRow } from "./KasirClient";
import { hariIniWIB } from "@/lib/tanggal";
import { loadServiceStaff, loggedInCashier } from "@/lib/service-performers-server";
import { loadKasirItems, loadKasirCatalogDetails, loadKasirGroupComponents } from "@/lib/kasir-catalog";
import { cacheSebentar, KATALOG_KASIR_UMUR_MS } from "@/lib/cache-memori";
import { loadBranchGroomingPolicy } from "@/lib/service-performers-server";
import { isGroomingService } from "@/lib/grooming-requirements";
import { readCompleteList } from "@/lib/checked-list";
import { loadActiveVouchers } from "@/lib/voucher-loader";
import { loadKodeKampanyeAktif } from "@/lib/kode-kampanye";
import { nonaktifkanPromoKadaluarsa } from "@/lib/promo-kadaluarsa";

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

  const [, master, vouchers, promos, kodeKampanye] = await Promise.all([
    // Penyapu promo/voucher kedaluwarsa ikut dijalankan dari sini karena kasir
    // adalah layar yang paling sering dibuka; fungsinya berhenti lebih awal
    // lewat indeks kalau memang tidak ada yang lewat tanggal. Hasil bacaan di
    // bawah tetap disaring tanggal, jadi urutannya tidak perlu dijamin.
    // Penyapu ini MENULIS ke database; cukup sekali per 5 menit per server — tampilan
    // promo/voucher di bawah tetap disaring tanggal saat dibaca.
    cacheSebentar("kasir:sapu-promo", 5 * 60_000, () => nonaktifkanPromoKadaluarsa(supabase)),
    // Katalog master (barang + satuan + komponen paket) sama untuk semua kasir dan
    // disimpan sementara sebagai SATU paket supaya ketiganya selalu cocok. Dulu dibaca
    // ulang (±60 permintaan) tiap layar kasir dibuka — ikut membuat database Micro
    // tumbang 1 Nov 2026.
    cacheSebentar("kasir:katalog-master", KATALOG_KASIR_UMUR_MS, async () => {
      const items = await loadKasirItems(supabase);
      const [units, groups] = await Promise.all([
        loadUnitOptions(supabase, items.map((i) => i.id)),
        loadKasirGroupComponents(supabase, items.filter((i) => i.item_type === "Grup").map((i) => i.id)),
      ]);
      return { items, units, groups };
    }),
    // Pelanggan TIDAK lagi dimuat di sini. Dulu seluruh 10.000+ pelanggan plus semua
    // penjualan & invoice dibaca tiap kasir dibuka (±20 permintaan, sampai 7 detik) —
    // kasir lambat & sempat gagal dibuka (1 Nov 2026). Sekarang layar mencari lewat
    // /api/pelanggan sambil mengetik, dan ringkasan transaksi dihitung per pelanggan
    // terpilih (lib/pelanggan-server).
    loadActiveVouchers(supabase),
    readCompleteList<PromoFull>((from,to)=>supabase.from("promos")
      .select("id, name, promo_type, rule, is_active, branch_ids, valid_from, valid_until, min_qty, max_qty, kelipatan, auto_apply, discount_type, discount_value",{count:"exact"})
      .eq("is_active", true).order("id").range(from,to),"Promo aktif kasir",{maxRows:null}),
    loadKodeKampanyeAktif(supabase),
  ]);
  const itemsRaw = master.items;
  const groomingPolicy = itemsRaw.some(item => isGroomingService(item.item_type, item.tindakan_kategori))
    ? await loadBranchGroomingPolicy(supabase, shift.branch_id) : { applies: false, doctorRequired: false };

  // Addendum: promo yang aktif hari ini untuk cabang shift (branch + tanggal).
  const wibToday = hariIniWIB();
  if (replacement && replacement.sale_items.some(row => !itemsRaw.some(item => item.id === row.item_id))) {
    redirect(`/penjualan/${replacement.id}?error=${encodeURIComponent("Sebagian barang sumber tidak tersedia di katalog aktif. Aktifkan atau tentukan barang pengganti sebelum membuat transaksi baru.")}`);
  }
  const promosActive = promos.filter((p) => promoActiveFor(p, shift.branch_id, wibToday));

  // Barang yang kena tiap promo (migrasi 0079). Promo tanpa baris di sini
  // berlaku untuk semua barang — lihat lib/promo-hitung.
  const promoItemRows: {promo_id:string;item_id:string}[]=[];
  for(let offset=0;offset<promosActive.length;offset+=200) {
    const ids=promosActive.slice(offset,offset+200).map(p=>p.id);
    promoItemRows.push(...await readCompleteList<{id:string;promo_id:string;item_id:string}>(async(from,to)=>{
      const result=await supabase.from("promo_items").select("promo_id,item_id",{count:"exact"})
        .in("promo_id",ids).order("promo_id").order("item_id").range(from,to);
      return {...result,data:result.data?.map(row=>({...row,id:`${row.promo_id}:${row.item_id}`}))??null};
    },"Target promo kasir",{maxRows:null}));
  }
  const itemsPerPromo = new Map<string, string[]>();
  for (const r of promoItemRows) {
    itemsPerPromo.set(r.promo_id, [...(itemsPerPromo.get(r.promo_id) ?? []), r.item_id]);
  }
  const promoHitung: PromoHitung[] = promosActive.map((p) => {
    const itemIds=itemsPerPromo.get(p.id) ?? [];
    const pricing=promoPricingRule(p.rule,itemIds);
    validatePackageDiscount(pricing.discountMode,p.discount_type,p.min_qty,itemIds);
    return ({
    id: p.id, name: p.name,
    itemIds,
    unit: typeof p.rule?.unit === "string" ? p.rule.unit : null,
    minQty: p.min_qty == null ? null : Number(p.min_qty),
    maxQty: p.max_qty == null ? null : Number(p.max_qty),
    kelipatan: !!p.kelipatan,
    autoApply: !!p.auto_apply,
    discountType: p.discount_type,
    discountValue: p.discount_value == null ? null : Number(p.discount_value),
    ...pricing,
    minSubtotal: p.rule?.min_subtotal ?? null,
  });
  });

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


  // Harga jual bisa beda per cabang (migrasi 0073) — dipakai harga cabang shift ini.
  const harga = new Map(details.prices.map(row => [`${row.item_id}|${row.unit}`, Number(row.sell_price)]));
  // Nama barang substitusi diambil dari daftar yang sama — tidak perlu query lagi.
  const namaById = new Map(itemsRaw.map((i) => [i.id, i.name]));

  // Satuan berjenjang (dus/renteng/pcs) ikut dikirim ke layar. Sebelum ini layar
  // kasir sama sekali tidak membaca item_units, jadi satuan yang sudah dibuat di
  // master tidak bisa dipilih saat jualan (dilaporkan tim 2026-08-11).
  const unitMap = master.units;
  const groupComponentRows = master.groups;

  // Grup tidak punya stok sendiri. Stok jualnya = jumlah paket paling kecil yang
  // masih bisa dirakit dari seluruh komponen Persediaan di gudang shift.
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
      // Single-unit products still need their official unit/factor for pool
      // eligibility. The client only shows a dropdown when length > 1.
      satuan: i.item_type !== "Grup" && satuan.length > 0 ? satuan : undefined,
    };
  });

  const salespeople = await loadServiceStaff(supabase, shift.branch_id);


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
      vouchers={vouchersAktif as unknown as VoucherRow[]}
      kodeKampanye={kodeKampanye}
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
