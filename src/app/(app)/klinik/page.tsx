import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ModuleHome } from "@/components/ModuleHome";
import { StaffKlinikHome } from "@/components/StaffKlinikHome";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name, role").eq("id", user.id).single();

  // STAFF dapat layar sambutan klinik; admin/owner tetap tile-grid.
  if (profile?.role === "STAFF") {
    return <StaffKlinikHome fullName={profile.full_name ?? "Staff"} />;
  }

  return <ModuleHome moduleId="klinik" />;
}
