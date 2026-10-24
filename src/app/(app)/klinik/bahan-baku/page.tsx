import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {readCompleteList,ListLoadError} from "@/lib/checked-list";
import {flatOptions,labelPath,type KategoriRow} from "@/lib/kategori";
import { SecHeader } from "@/components/SecHeader";
import { BahanBakuClient, type ItemRow } from "./BahanBakuClient";

export default async function BahanBakuPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") redirect("/klinik"); // master data admin-only (selaras RLS 0045)

  let items: ItemRow[] = [];
  let categories: KategoriRow[] = [];
  let loadError = "";
  try {
    const [master, eligible] = await Promise.all([
      readCompleteList<KategoriRow>((from,to) => supabase.from("item_categories")
        .select("id,name,parent_id,is_active", {count:"exact"}).order("name").order("id").range(from,to),
      "Kategori bahan racikan", {maxRows:null}),
      readCompleteList<{id:string;code:string;name:string;category_id:string|null;sell_price:number;is_compound_material:boolean}>((from,to) => supabase.from("items")
        .select("id,code,name,category_id,sell_price,is_compound_material", {count:"exact"})
        .eq("is_active",true).eq("item_type","Persediaan").is("trashed_at",null)
        .order("name").order("id").range(from,to), "Barang bahan racikan", {maxRows:null}),
    ]);
    categories = master;
    const active = new Set(flatOptions(master).map(row => row.id));
    items = eligible.map(row => {
      const path = row.category_id ? labelPath(row.category_id,master) : "";
      return {...row, sell_price:Number(row.sell_price), is_compound_material:Boolean(row.is_compound_material),
        kategori: !row.category_id ? "Tanpa kategori" : !path ? "Kategori tidak tersedia"
          : active.has(row.category_id) ? path : `${path} (kategori nonaktif / hierarki tidak tersedia)`};
    });
  } catch (error) {
    if (!(error instanceof ListLoadError)) throw error;
    loadError = error.message;
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik/racik" className="back-btn"><i className="ti ti-arrow-left" /> Racik Obat</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Bahan Baku Racikan</span>
      </div>
      <div className="crm-sec">
        <SecHeader num="01" title="BAHAN BAKU RACIKAN" desc="Tandai barang yang jadi bahan baku racikan. Barang bertanda hanya muncul di builder racikan dokter, bukan di daftar obat jadi." />
        {loadError ? <div role="alert">{loadError} <Link href="/klinik/bahan-baku">Muat ulang</Link></div> : <BahanBakuClient items={items} categories={categories} />}
      </div>
    </>
  );
}
