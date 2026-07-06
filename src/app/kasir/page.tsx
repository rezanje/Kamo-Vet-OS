import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { promoActiveFor, type PromoRow as PromoFull } from "@/lib/promo";
import { KasirClient, type ItemRow, type CustRow, type DraftRow, type VoucherRow, type PromoRow } from "./KasirClient";

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

  const [{ data: items }, { data: customers }, { data: salesCnt }, { data: drafts }, { data: vouchers }, { data: promos }] = await Promise.all([
    supabase.from("items").select("id, code, name, sell_price, target_species, item_categories(name)").eq("is_active", true).order("name"),
    supabase.from("customers").select("id, name, phone, points, tier, keanggotaan").order("name"),
    supabase.from("sales").select("customer_id"),
    supabase.from("sale_drafts").select("id, customer_id, cart, created_at").eq("cashier_id", user.id).order("created_at", { ascending: false }),
    supabase.from("vouchers").select("code, tipe, nilai").eq("is_active", true),
    supabase.from("promos").select("id, name, promo_type, rule, is_active, branch_ids, valid_from, valid_until").eq("is_active", true),
  ]);

  // Addendum: promo yang aktif hari ini untuk cabang shift (branch + tanggal).
  const wibToday = new Date(new Date().getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const promosActive = ((promos ?? []) as unknown as PromoFull[]).filter((p) => promoActiveFor(p, shift.branch_id, wibToday));

  // stok di gudang pertama cabang shift (tampilan stok toko).
  const { data: wh } = await supabase
    .from("warehouses").select("id").eq("branch_id", shift.branch_id).eq("is_active", true).order("type").limit(1).maybeSingle();
  const stockMap: Record<string, number> = {};
  if (wh) {
    const { data: st } = await supabase.from("stock").select("item_id, qty").eq("warehouse_id", wh.id);
    for (const s of st ?? []) stockMap[s.item_id as string] = Number(s.qty);
  }

  // jumlah transaksi per pelanggan (buat panel customer).
  const trxCount: Record<string, number> = {};
  for (const s of (salesCnt ?? []) as { customer_id: string | null }[]) {
    if (s.customer_id) trxCount[s.customer_id] = (trxCount[s.customer_id] ?? 0) + 1;
  }

  const itemRows: ItemRow[] = ((items ?? []) as unknown as { id: string; code: string; name: string; sell_price: number; target_species: string; item_categories: Rel<{ name: string }> }[]).map((i) => ({
    id: i.id, code: i.code, name: i.name, harga: Number(i.sell_price),
    kategori: one(i.item_categories)?.name ?? "Lainnya",
    stok: stockMap[i.id] ?? 0,
  }));

  const custRows: CustRow[] = ((customers ?? []) as { id: string; name: string; phone: string; points: number; tier: string | null; keanggotaan: string }[]).map((c) => ({
    ...c, trx: trxCount[c.id] ?? 0,
  }));

  return (
    <KasirClient
      branchName={shift.branchName}
      items={itemRows}
      customers={custRows}
      drafts={(drafts ?? []) as unknown as DraftRow[]}
      vouchers={(vouchers ?? []) as unknown as VoucherRow[]}
      promos={promosActive as unknown as PromoRow[]}
      error={error}
    />
  );
}
