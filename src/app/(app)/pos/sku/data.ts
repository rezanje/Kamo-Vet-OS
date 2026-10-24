import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadItemUnits, unitOptions } from "@/lib/satuan";
import { completeReportQuery } from "@/lib/report-query";
import { readCompleteList } from "@/lib/checked-list";
import type { BarangRow, KandidatKomponenGrup } from "./BarangForm";

export const BARANG_FIELDS =
  "id, name, code, unit, upc, category_id, brand_id, item_type, sell_price, buy_price, min_stock, track_expiry, is_active, tindakan_kategori, supplier_id, buy_unit, min_buy, min_sell_qty, default_discount, substitute_item_id";

// Guard + isi dropdown yang sama untuk halaman baru & edit.
export async function siapkanFormBarang() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active || (profile.role !== "OWNER" && profile.role !== "ADMIN")) {
    redirect(`/pos/sku?error=${encodeURIComponent("Hanya OWNER/ADMIN yang boleh mengubah master barang")}`);
  }

  const [
    categories, brands, units, suppliers,
    { data: barangLain }, { data: kandidatGrupRaw },
  ] = await Promise.all([
    // parent_id & is_active dipakai flatOptions() utk label bertingkat + buang cabang mati.
    readCompleteList<{ id: string; name: string; parent_id: string | null; is_active: boolean }>((from, to) => supabase
      .from("item_categories").select("id, name, parent_id, is_active", { count: "exact" })
      .order("name").order("id").range(from, to), "Kategori barang", { maxRows: null }),
    readCompleteList<{ id: string; name: string }>((from, to) => supabase
      .from("brands").select("id, name", { count: "exact" }).eq("is_active", true)
      .order("name").order("id").range(from, to), "Merek barang", { maxRows: null }),
    readCompleteList<{ id: string; nama: string }>((from, to) => supabase
      .from("units").select("id, nama", { count: "exact" }).eq("is_active", true)
      .order("nama").order("id").range(from, to), "Satuan barang", { maxRows: null }),
    readCompleteList<{ id: string; nama: string }>((from, to) => supabase
      .from("suppliers").select("id, nama", { count: "exact" }).eq("is_active", true)
      .order("nama").order("id").range(from, to), "Pemasok barang", { maxRows: null }),
    // Kandidat barang substitusi — jasa tidak punya stok, jadi tidak bisa jadi pengganti.
    completeReportQuery<{ id: string; code: string; name: string }>(
      supabase.from("items").select("id, code, name", { count: "exact" }).eq("is_active", true)
        .eq("item_type", "Persediaan").order("name")),
    // Komponen Grup boleh Persediaan/Jasa/Non-Persediaan, tetapi tidak boleh Grup.
    completeReportQuery<Omit<KandidatKomponenGrup, "units">>(
      supabase.from("items").select("id, code, name, unit, item_type, sell_price, buy_price", { count: "exact" })
        .eq("is_active", true).neq("item_type", "Grup").order("name")),
  ]);

  const kandidatIds = ((kandidatGrupRaw ?? []) as { id: string }[]).map((row) => row.id);
  const unitMap = await loadItemUnits(supabase, kandidatIds);
  const kandidatGrup = ((kandidatGrupRaw ?? []) as Omit<KandidatKomponenGrup, "units">[])
    .map((row) => ({
      ...row,
      units: unitOptions(row, unitMap.get(row.id) ?? [])
        .map((u) => ({ unit: u.unit, factor: u.factor })),
    }));

  return {
    supabase, categories: categories ?? [], brands: brands ?? [], units: units ?? [],
    suppliers: suppliers ?? [], barangLain: barangLain ?? [], kandidatGrup,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadBarang(supabase: any, id: string): Promise<BarangRow | null> {
  const { data } = await supabase.from("items").select(`${BARANG_FIELDS}, brands(name), suppliers(nama)`).is("trashed_at", null).eq("id", id).maybeSingle();
  if (!data) return null;
  const [units, { data: tiers }, { data: groupComponents }] = await Promise.all([
    loadItemUnits(supabase, [id]),
    supabase.from("item_price_tiers").select("min_qty, harga").eq("item_id", id).order("min_qty"),
    supabase.from("item_group_components")
      .select("component_item_id, qty, unit, factor")
      .eq("group_item_id", id).order("sort_order"),
  ]);
  return {
    ...(data as BarangRow),
    brand_name: (Array.isArray(data.brands) ? data.brands[0] : data.brands)?.name ?? null,
    supplier_name: (Array.isArray(data.suppliers) ? data.suppliers[0] : data.suppliers)?.nama ?? null,
    units: units.get(id) ?? [],
    tiers: ((tiers ?? []) as { min_qty: number; harga: number }[])
      .map((t) => ({ min_qty: Number(t.min_qty), harga: Number(t.harga) })),
    group_components: ((groupComponents ?? []) as {
      component_item_id: string; qty: number; unit: string; factor: number;
    }[]).map((row) => ({
      ...row,
      qty: Number(row.qty),
      factor: Number(row.factor),
    })),
  };
}
