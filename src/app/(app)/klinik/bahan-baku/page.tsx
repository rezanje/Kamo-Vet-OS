import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { BahanBakuClient, type ItemRow } from "./BahanBakuClient";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

export default async function BahanBakuPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role === "STAFF") redirect("/klinik"); // master data admin-only

  const { data } = await supabase
    .from("items")
    .select("id, code, name, sell_price, is_compound_material, item_categories(name)")
    .eq("is_active", true)
    .order("name");

  const items: ItemRow[] = (data ?? []).map((i) => ({
    id: i.id as string, code: i.code as string, name: i.name as string,
    sell_price: Number(i.sell_price),
    is_compound_material: Boolean(i.is_compound_material),
    kategori: one(i.item_categories as Rel<{ name: string }>)?.name ?? "Lainnya",
  }));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik/racik" className="back-btn"><i className="ti ti-arrow-left" /> Racik Obat</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Bahan Baku Racikan</span>
      </div>
      <div className="crm-sec">
        <SecHeader num="01" title="BAHAN BAKU RACIKAN" desc="Tandai barang yang jadi bahan baku racikan. Barang bertanda hanya muncul di builder racikan dokter, bukan di daftar obat jadi." />
        <BahanBakuClient items={items} />
      </div>
    </>
  );
}
