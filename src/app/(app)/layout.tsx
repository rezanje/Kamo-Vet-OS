import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/Sidebar";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Clock } from "@/components/Clock";
import { KlinikTopbar } from "@/components/KlinikTopbar";
import { getOpenShift } from "@/lib/shift";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  // branches: master ref, readable by any authenticated user (RLS).
  const { data: branches } = await supabase
    .from("branches")
    .select("code, name")
    .eq("is_active", true)
    .order("name");

  // STAFF cuma masuk (app) lewat alur kasir klinik (/klinik/shift & seterusnya) —
  // sidebar admin (Keuangan, HRIS, Pengaturan, dst) bukan buat mereka.
  const isStaff = profile?.role === "STAFF";
  const staffBranch = isStaff ? await getOpenShift(supabase as never, user.id, "klinik") : null;

  return (
    <div className="shell">
      {!isStaff && (
        <Sidebar
          branches={branches ?? []}
          fullName={profile?.full_name ?? user.email ?? "Pengguna"}
          role={profile?.role ?? "—"}
        />
      )}
      <div className="main">
        {isStaff ? (
          <KlinikTopbar fullName={profile?.full_name ?? "Staff"} branchName={staffBranch?.branchName ?? "—"} />
        ) : (
          <div className="topbar">
            <Breadcrumb />
            <Clock />
          </div>
        )}
        <div className="ct">{children}</div>
      </div>
    </div>
  );
}
