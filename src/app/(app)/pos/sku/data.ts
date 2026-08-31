import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadItemUnits, unitOptions } from "@/lib/satuan";
import type { BarangRow, KandidatKomponenGrup } from "./BarangForm";

export const BARANG_FIELDS =
  "id, name, code, unit, upc, category_id, brand_id, item_type, sell_price, buy_price, min_stock, track_expiry, is_active, tindakan_kategori, supplier_id, buy_unit, min_buy, min_sell_qty, default_discount, substitute_item_id";

// Guard + isi dropdown yang sama untuk halaman baru & edit.
export async function siapkanFormBarang() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") {
    redirect(`/pos/sku?error=${encodeURIComponent("Hanya OWNER/ADMIN yang boleh mengubah master barang")}`);
  }

  const [
    { data: categories }, { data: brands }, { data: units }, { data: suppliers },
    { data: barangLain }, { data: kandidatGrupRaw },
  ] = await Promise.all([
    // parent_id & is_active dipakai flatOptions() utk label bertingkat + buang cabang mati.
    supabase.from("item_categories").select("id, name, parent_id, is_active").order("name"),
    supabase.from("brands").select("id, name").eq("is_active", true).order("name"),
    supabase.from("units").select("id, nama").eq("is_active", true).order("nama"),
    supabase.from("suppliers").select("id, nama").order("nama"),
    // Kandidat barang substitusi — jasa tidak punya stok, jadi tidak bisa jadi pengganti.
    supabase.from("items").select("id, code, name").eq("is_active", true)
      .eq("item_type", "Persediaan").order("name").limit(1000),
    // Komponen Grup boleh Persediaan/Jasa/Non-Persediaan, tetapi tidak boleh Grup.
    supabase.from("items").select("id, code, name, unit, item_type, sell_price, buy_price")
      .eq("is_active", true).neq("item_type", "Grup").order("name").limit(5000),
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
  const { data } = await supabase.from("items").select(BARANG_FIELDS).eq("id", id).maybeSingle();
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
