import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { ModuleHome } from "@/components/ModuleHome";
import { StaffKlinikHome } from "@/components/StaffKlinikHome";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name, role").eq("id", user.id).single();
  const shift = await getOpenShift(supabase, user.id, "klinik");

  // STAFF dapat layar sambutan klinik; admin/owner tetap tile-grid.
  if (profile?.role === "STAFF") {
    if (!shift) redirect("/klinik/shift");
    return <StaffKlinikHome fullName={profile.full_name ?? "Staff"} />;
  }

  return <>
    <div className="card" style={{ padding: 14, marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontWeight: 700 }}>Shift kas klinik</div>
        <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 4 }}>
          {shift ? "Shift kas Anda sedang berjalan. Tutup setelah selesai bertugas." : "Pemantauan klinik tidak membutuhkan shift. Mulai shift saat akan bertugas di kasir."}
        </div>
      </div>
      <Link href="/klinik/shift" className="btn-acc">{shift ? "Tutup shift klinik" : "Mulai shift klinik"}</Link>
    </div>
    <ModuleHome moduleId="klinik" />
  </>;
}
