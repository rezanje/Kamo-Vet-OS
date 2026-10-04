import { ModuleHome } from "@/components/ModuleHome";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user ? await supabase.from("profiles").select("role").eq("id",user.id).maybeSingle() : { data: null };
  return <>
    {["OWNER","FINANCE"].includes(profile?.role ?? "") && <div className="crm-sec" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <Link className="btn-def" href="/laporan/nilai-persediaan"><i className="ti ti-package" /> Nilai Persediaan FIFO</Link>
      <Link className="btn-def" href="/laporan/margin-racikan"><i className="ti ti-flask" /> HPP & Margin Racikan</Link>
    </div>}
    <ModuleHome moduleId="laporan" />
  </>;
}
