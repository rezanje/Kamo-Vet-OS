import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { promoActiveFor, type PromoRow as PromoFull } from "@/lib/promo";
import { voucherBerlaku, type VoucherRow as VoucherFull } from "@/lib/voucher";
import type { PromoHitung } from "@/lib/promo-hitung";
import { loadInfoBarang, type AturanDiskon } from "@/lib/harga-golongan";
import { loadHargaCabang, hargaCabang } from "@/lib/harga-cabang";
import { KasirClient, type ItemRow, type CustRow, type VoucherRow, type PromoRow } from "./KasirClient";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

export default async function KasirPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // hard gate: tanpa shift terbuka tidak boleh masuk kasir.
  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const [{ data: items }, { data: customers }, { data: salesAgg }, { data: invAgg }, { data: vouchers }, { data: promos }] = await Promise.all([
    supabase.from("items").select("id, code, name, unit, sell_price, target_species, min_sell_qty, default_discount, substitute_item_id, item_categories(name)").eq("is_active", true).order("name"),
    // Golongan ikut dibawa: diskon & rumus poinnya dipakai layar kasir untuk
    // MENAMPILKAN total yang sama dengan yang nanti dihitung server saat bayar.
    supabase.from("customers")
      .select("id, name, phone, points, tier, kategori, category_id, customer_categories(nama, diskon_persen, rupiah_per_poin, is_active)")
      .order("name"),
    supabase.from("sales").select("customer_id, total"),
    supabase
      .from("invoices")
      .select("total, visits!inner(customer_id)")
      .eq("paid_status", "Lunas")
      .is("voided_at", null),
    supabase.from("vouchers")
      .select("code, tipe, nilai, is_active, valid_from, valid_until, max_potongan, min_belanja, boleh_gabung_promo")
      .eq("is_active", true),
    supabase.from("promos")
      .select("id, name, promo_type, rule, is_active, branch_ids, valid_from, valid_until, min_qty, max_qty, kelipatan, auto_apply, discount_type, discount_value")
      .eq("is_active", true),
  ]);

  // Addendum: promo yang aktif hari ini untuk cabang shift (branch + tanggal).
  const wibToday = new Date(new Date().getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
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
  const { data: wh } = await supabase
    .from("warehouses").select("id").eq("branch_id", shift.branch_id).eq("is_active", true).order("type").limit(1).maybeSingle();
  const stockMap: Record<string, number> = {};
  if (wh) {
    const { data: st } = await supabase.from("stock").select("item_id, qty").eq("warehouse_id", wh.id);
    for (const s of st ?? []) stockMap[s.item_id as string] = Number(s.qty);
  }

  // Ringkasan transaksi per pelanggan (petshop sales + klinik invoices lunas,
  // semua waktu) — sama pola dengan header detail owner di antrian.
  const trxCount: Record<string, number> = {};
  const trxSum: Record<string, number> = {};
  for (const s of (salesAgg ?? []) as { customer_id: string | null; total: number }[]) {
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
  const harga = await loadHargaCabang(supabase, shift.branch_id);

  type ItemRaw = {
    id: string; code: string; name: string; unit: string; sell_price: number; target_species: string;
    min_sell_qty: number; default_discount: number; substitute_item_id: string | null;
    item_categories: Rel<{ name: string }>;
  };
  const itemsRaw = (items ?? []) as unknown as ItemRaw[];
  // Nama barang substitusi diambil dari daftar yang sama — tidak perlu query lagi.
  const namaById = new Map(itemsRaw.map((i) => [i.id, i.name]));

  const itemRows: ItemRow[] = itemsRaw.map((i) => ({
    id: i.id, code: i.code, name: i.name, harga: hargaCabang(harga, i.id, i.unit, Number(i.sell_price)),
    kategori: one(i.item_categories)?.name ?? "Lainnya",
    stok: stockMap[i.id] ?? 0,
    minJual: Number(i.min_sell_qty) || 0,
    diskonDefault: Number(i.default_discount) || 0,
    substitusi: i.substitute_item_id ? namaById.get(i.substitute_item_id) ?? null : null,
  }));

  type CustRaw = {
    id: string; name: string; phone: string; points: number; tier: string | null; kategori: string;
    category_id: string | null;
    customer_categories: Rel<{ nama: string; diskon_persen: number; rupiah_per_poin: number; is_active: boolean }>;
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
    };
  });

  // Pengecualian diskon per produk/kategori (0082) + kategori tiap barang.
  // Dikirim ke layar supaya angka yang dilihat kasir sama dengan yang nanti
  // dihitung server saat bayar — bukan supaya klien yang menentukan diskonnya.
  const [{ data: aturanRows }, infoBarang] = await Promise.all([
    supabase.from("category_discounts").select("customer_category_id, item_id, item_category_id, diskon_persen"),
    loadInfoBarang(supabase),
  ]);
  const aturanPerGolongan: Record<string, AturanDiskon[]> = {};
  for (const a of (aturanRows ?? []) as (AturanDiskon & { customer_category_id: string })[]) {
    (aturanPerGolongan[a.customer_category_id] ??= []).push({
      item_id: a.item_id, item_category_id: a.item_category_id, diskon_persen: Number(a.diskon_persen),
    });
  }

  return (
    <KasirClient
      branchName={shift.branchName}
      items={itemRows}
      customers={custRows}
      vouchers={vouchersAktif as unknown as VoucherRow[]}
      hariIni={wibToday}
      promos={promosActive as unknown as PromoRow[]}
      promoHitung={promoHitung}
      aturanDiskon={aturanPerGolongan}
      infoBarang={Object.fromEntries(infoBarang)}
      error={error}
    />
  );
}
