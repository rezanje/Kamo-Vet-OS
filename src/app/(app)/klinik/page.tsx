import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ModuleHome } from "@/components/ModuleHome";
import { StaffKlinikHome } from "@/components/StaffKlinikHome";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const { success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name, role").eq("id", user.id).single();

  return (
    <>
      {success === "close" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Shift ditutup.
        </div>
      )}
      {/* STAFF dapat layar sambutan klinik; admin/owner tetap tile-grid. */}
      {profile?.role === "STAFF"
        ? <StaffKlinikHome fullName={profile.full_name ?? "Staff"} />
        : <ModuleHome moduleId="klinik" />}
    </>
  );
}
