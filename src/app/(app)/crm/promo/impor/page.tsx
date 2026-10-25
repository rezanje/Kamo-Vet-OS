import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { readCompleteList } from "@/lib/checked-list";
import { hariIniWIB } from "@/lib/tanggal";
import { SecHeader } from "@/components/SecHeader";
import { PromoImportWorkspace } from "./PromoImportWorkspace";

export default async function PromoImportPage() {
  const db=await createClient();
  const {data:{user}}=await db.auth.getUser();
  const {data:me}=await db.from("profiles").select("role,is_active").eq("id",user?.id??"").maybeSingle();
  const allowed=!!user&&!!me?.is_active&&["OWNER","ADMIN"].includes(me.role);
  const branches=allowed?await readCompleteList<{id:string;name:string}>((from,to)=>db.from("branches")
    .select("id,name",{count:"exact"}).eq("is_active",true).order("name").order("id").range(from,to),
    "Cabang untuk impor promo",{maxRows:null}):[];
  return <>
    <Link href="/crm/promo" className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke Promo</Link>
    <div className="crm-sec" style={{marginTop:12}}>
      <SecHeader num="01" title="IMPOR PROMO EXCEL" desc="Satu baris untuk satu SKU, satuan, dan diskon. Seluruh batch disimpan bersama setelah preview." />
      {allowed?<PromoImportWorkspace branches={branches} today={hariIniWIB()}/>:
        <p>Hanya Owner/Admin aktif yang boleh mengimpor promo.</p>}
    </div>
  </>;
}
