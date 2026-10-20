import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadItemUnits, unitOptions } from "@/lib/satuan";
import { PosClient, type Item, type Cust } from "./PosClient";
import { daftarPenjual } from "@/lib/penjual";
import { loadAturanDiskon, loadInfoBarang } from "@/lib/harga-golongan";
import { loadPromoAktif } from "@/lib/promo-hitung";
import { readCompleteList } from "@/lib/checked-list";

type CatalogItem = { id: string; code: string; name: string; unit: string; sell_price: number; target_species: string };

export default async function TransaksiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; completed_sale_id?: string; draft_used?: string }>;
}) {
  const { error, completed_sale_id: completedSaleId, draft_used: usedDraftKey } = await searchParams;
  const supabase = await createClient();

  const [items, { data: customers }, { data: branches }, salespeople] = await Promise.all([
    readCompleteList<CatalogItem>((from, to) => supabase.from("items").select("id, code, name, unit, sell_price, target_species", { count: "exact" }).eq("is_active", true).order("name").order("id").range(from, to), "Daftar barang POS", { maxRows: null }),
    supabase.from("customers").select("id, name, phone, points, category_id, customer_categories(nama, diskon_persen, rupiah_per_poin, is_active), pets(id, name, species)").order("name"),
    supabase.from("branches").select("id, code, name").eq("is_active", true).order("name"),
    daftarPenjual(supabase, ""),
  ]);

  // Satuan berjenjang: kasir pilih pcs/box saat menambah ke keranjang.
  const unitMap = await loadItemUnits(supabase, items.map((i) => i.id));
  const katalog: Item[] = items.map((i) => ({
    id: i.id as string,
    code: i.code as string,
    name: i.name as string,
    sell_price: Number(i.sell_price),
    target_species: i.target_species as string,
    units: unitOptions({ unit: i.unit as string, sell_price: Number(i.sell_price) }, unitMap.get(i.id as string) ?? []),
  }));

  // Pengecualian harga per cabang (migrasi 0073) — jumlahnya sedikit, jadi dikirim
  // utuh ke klien supaya ganti cabang langsung mengubah harga tanpa reload.
  const { data: overrides } = await supabase
    .from("item_branch_prices").select("item_id, branch_id, unit, sell_price");
  const hargaPerCabang: Record<string, Record<string, number>> = {};
  for (const o of (overrides ?? []) as { item_id: string; branch_id: string; unit: string; sell_price: number }[]) {
    (hargaPerCabang[o.branch_id] ??= {})[`${o.item_id}|${o.unit}`] = Number(o.sell_price);
  }

  // Relasi Supabase bisa datang sebagai objek ATAU array — dinormalkan sekali di sini
  // supaya kasir cukup baca satu bentuk (`golongan`).
  type CustomerCategory = { nama: string; diskon_persen: number; rupiah_per_poin: number | null; is_active: boolean };
  const pelanggan = ((customers ?? []) as unknown as (Omit<Cust, "golongan"> & {
    category_id: string | null;
    customer_categories: CustomerCategory | CustomerCategory[] | null;
  })[]).map((c) => {
    const k = Array.isArray(c.customer_categories) ? c.customer_categories[0] : c.customer_categories;
    return {
      ...c,
      golonganId: k?.is_active ? c.category_id : null,
      golongan: k?.is_active ? { nama: k.nama, diskon_persen: Number(k.diskon_persen), rupiah_per_poin: k.rupiah_per_poin == null ? null : Number(k.rupiah_per_poin) } : null,
    };
  });

  const categoryIds = [...new Set(pelanggan.flatMap(customer => customer.golonganId ? [customer.golonganId] : []))];
  const [promoEntries, discountEntries, itemInfo] = await Promise.all([
    Promise.all((branches ?? []).map(async branch => [branch.id, await loadPromoAktif(supabase, branch.id)] as const)),
    Promise.all(categoryIds.map(async categoryId => [categoryId, await loadAturanDiskon(supabase, categoryId)] as const)),
    loadInfoBarang(supabase, katalog.map(item => item.id)),
  ]);

  const { data: { user } } = await supabase.auth.getUser();
  const { data: openShift } = await supabase
    .from("cashier_shifts").select("id").eq("opened_by", user?.id ?? "").eq("status", "open")
    .eq("shift_type", "petshop").maybeSingle();

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Transaksi POS</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {completedSaleId && usedDraftKey && (
        <div className="p2ban">
          <Link href={`/pos/struk/${encodeURIComponent(completedSaleId)}?draft_done=${encodeURIComponent(usedDraftKey)}`}>
            Lihat struk &amp; mulai transaksi baru
          </Link>
        </div>
      )}
      {!openShift && (
        <div className="p2ban" style={{ justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <i className="ti ti-clock-pause" /> Shift belum dibuka — penjualan tidak tercatat ke rekonsiliasi kas.
          </span>
          <Link href="/pos/shift" className="btn-acc" style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>Buka shift</Link>
        </div>
      )}

      <PosClient
        items={katalog}
        customers={pelanggan}
        branches={branches ?? []}
        salespeople={salespeople}
        hargaPerCabang={hargaPerCabang}
        promoPerCabang={Object.fromEntries(promoEntries)}
        aturanDiskon={Object.fromEntries(discountEntries)}
        infoBarang={Object.fromEntries(itemInfo)}
      />
    </>
  );
}
