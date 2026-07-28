import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadItemUnits } from "@/lib/satuan";
import type { BarangRow } from "./BarangForm";

export const BARANG_FIELDS =
  "id, name, code, unit, upc, category_id, brand_id, item_type, sell_price, buy_price, min_stock, is_active, tindakan_kategori";

// Guard + isi dropdown yang sama untuk halaman baru & edit.
export async function siapkanFormBarang() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") {
    redirect(`/pos/sku?error=${encodeURIComponent("Hanya OWNER/ADMIN yang boleh mengubah master barang")}`);
  }

  const [{ data: categories }, { data: brands }, { data: units }] = await Promise.all([
    // parent_id & is_active dipakai flatOptions() utk label bertingkat + buang cabang mati.
    supabase.from("item_categories").select("id, name, parent_id, is_active").order("name"),
    supabase.from("brands").select("id, name").eq("is_active", true).order("name"),
    supabase.from("units").select("id, nama").eq("is_active", true).order("nama"),
  ]);

  return { supabase, categories: categories ?? [], brands: brands ?? [], units: units ?? [] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadBarang(supabase: any, id: string): Promise<BarangRow | null> {
  const { data } = await supabase.from("items").select(BARANG_FIELDS).eq("id", id).maybeSingle();
  if (!data) return null;
  const units = await loadItemUnits(supabase, [id]);
  return { ...(data as BarangRow), units: units.get(id) ?? [] };
}
