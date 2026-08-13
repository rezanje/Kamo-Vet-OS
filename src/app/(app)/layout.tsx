import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/Sidebar";
import { Breadcrumb } from "@/components/Breadcrumb";
import { PageTabs } from "@/components/PageTabs";
import { Clock } from "@/components/Clock";
import { CariGlobal } from "@/components/CariGlobal";
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
    .select("full_name, role, is_active")
    .eq("id", user.id)
    .single();

  // akun dinonaktifkan admin → keluar paksa
  if (profile && profile.is_active === false) {
    await supabase.auth.signOut();
    redirect("/login?error=" + encodeURIComponent("Akun Anda dinonaktifkan. Hubungi admin."));
  }

  // branches: master ref, readable by any authenticated user (RLS).
  // Aturan Akses Grup dibaca sekali di sini supaya sidebar menampilkan modul yang
  // benar-benar bisa dibuka — daftar yang sama dipakai middleware.
  const [{ data: branches }, { data: aksesModul }] = await Promise.all([
    supabase.from("branches").select("code, name").eq("is_active", true).order("name"),
    supabase.from("role_modules").select("role, module_id"),
  ]);

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
          aksesModul={aksesModul ?? []}
        />
      )}
      <div className="main">
        {isStaff ? (
          <KlinikTopbar fullName={profile?.full_name ?? "Staff"} branchName={staffBranch?.branchName ?? "—"} />
        ) : (
          <>
            <PageTabs />
            <div className="topbar">
              <Breadcrumb />
              {/* Menu aplikasi ini banyak; tanpa kotak cari orang menghabiskan
                  waktu menelusuri sidebar untuk layar yang sudah dia tahu namanya. */}
              <CariGlobal role={profile?.role ?? "STAFF"} aturan={aksesModul ?? []} />
              <Clock />
            </div>
          </>
        )}
        <div className="ct">{children}</div>
      </div>
    </div>
  );
}
