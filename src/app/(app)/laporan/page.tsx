import { ReportCatalog } from "@/components/ReportCatalog";
import { buildReportCatalog } from "@/lib/report-catalog";
import type { AturanTersimpan } from "@/lib/akses";
import { createClient } from "@/lib/supabase/server";
import { Suspense } from "react";
import { ReportPresets } from "@/components/ReportPresets";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if(authError||!user)return <p role="alert">Sesi katalog laporan belum dapat diverifikasi. Masuk ulang.</p>;
  const {data:profile,error:profileError}=await supabase.from("profiles").select("role,is_active").eq("id",user.id).maybeSingle();
  if(profileError||profile?.is_active!==true)return <p role="alert">Akun aktif untuk katalog laporan belum dapat diverifikasi.</p>;
  const {data:rules,error:rulesError}=await supabase.from("role_modules").select("role,module_id").eq("role",profile.role);
  if(rulesError||!Array.isArray(rules))return <p role="alert">Hak akses katalog laporan belum dapat diverifikasi. Muat ulang.</p>;
  return <>
    <Suspense fallback={null}><ReportPresets title="Laporan" directory /></Suspense>
    <ReportCatalog entries={buildReportCatalog(profile.role,rules as AturanTersimpan)}/>
  </>;
}
