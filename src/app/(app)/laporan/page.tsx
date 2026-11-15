import { aturanEfektif, bacaAkses } from "@/lib/akses-akun";
import { ReportCatalog } from "@/components/ReportCatalog";
import { buildReportCatalog } from "@/lib/report-catalog";
import { createClient } from "@/lib/supabase/server";
import { Suspense } from "react";
import { ReportPresets } from "@/components/ReportPresets";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if(authError||!user)return <p role="alert">Sesi katalog laporan belum dapat diverifikasi. Masuk ulang.</p>;
  const {data:profile,error:profileError}=await supabase.from("profiles").select("role,is_active").eq("id",user.id).maybeSingle();
  if(profileError||profile?.is_active!==true)return <p role="alert">Akun aktif untuk katalog laporan belum dapat diverifikasi.</p>;
  // E3 (meeting 12 Nov 2026): katalog memakai akses efektif akun (peran + sub-menu + akses khusus), sama dengan menu.
  const akses=await bacaAkses(supabase,{role:profile.role});
  if(akses.rulesError||!Array.isArray(akses.rules))return <p role="alert">Hak akses katalog laporan belum dapat diverifikasi. Muat ulang.</p>;
  return <>
    <Suspense fallback={null}><ReportPresets title="Laporan" directory /></Suspense>
    <ReportCatalog entries={buildReportCatalog(profile.role,aturanEfektif(profile.role,akses))}/>
  </>;
}
