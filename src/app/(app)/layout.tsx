import { ActivityNavigationProvider } from "@/components/ActivityHistoryLink";
import { ActivityMenuLink } from "@/components/ActivityMenuLink";
import { bolehBukaPath } from "@/lib/akses";
import { Suspense } from "react";
import { DraftUserProvider, TransactionDraftComplete } from "@/components/LocalTransactionDraft";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/Sidebar";
import { Breadcrumb } from "@/components/Breadcrumb";
import { PageTabs } from "@/components/PageTabs";
import { Clock } from "@/components/Clock";
import { CariGlobal } from "@/components/CariGlobal";
import { KlinikTopbar } from "@/components/KlinikTopbar";
import { getOpenShift } from "@/lib/shift";
import { NavigationFeedback } from "@/components/NavigationFeedback";
import { ReleaseNotice } from "@/components/ReleaseNotice";
import { ActiveBranch } from "@/components/ActiveBranch";
import { branchDisplayName } from "@/lib/branch-display";
import { mulai } from "@/lib/u07-waktu";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  // branches: master ref, readable by any authenticated user (RLS).
  // Aturan Akses Grup dibaca sekali di sini supaya sidebar menampilkan modul yang
  // benar-benar bisa dibuka — daftar yang sama dipakai middleware.
  // Klinik-A: keduanya tidak bergantung pada akun, jadi dimulai bersama bacaan sesi
  // (dulu menunggu sesi lalu profil: layout ini ikut dirender di tiap halaman klinik).
  const branchesP = mulai(supabase.from("branches").select("id, code, name, type").eq("is_active", true).order("name"));
  const aksesModulP = mulai(supabase.from("role_modules").select("role, module_id"));
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Shift kasir klinik hanya dipakai akun STAFF; dibaca bersama profil dan hanya
  // ditunggu (beserta galatnya) bila akunnya memang STAFF.
  const staffShiftP = mulai(getOpenShift(supabase as never, user.id, "klinik"));

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

  const [{ data: branches }, { data: aksesModul }] = await Promise.all([branchesP, aksesModulP]);

  // STAFF cuma masuk (app) lewat alur kasir klinik (/klinik/shift & seterusnya) —
  // sidebar admin (Keuangan, HRIS, Pengaturan, dst) bukan buat mereka.
  const isStaff = profile?.role === "STAFF";
  const staffBranch = isStaff ? await staffShiftP : null;
  const activeBranch = await ActiveBranch({ catalog: branches ?? [] });
  const staffBranchMaster = branches?.find(branch => branch.id === staffBranch?.branch_id);
  const staffBranchName = staffBranchMaster ? branchDisplayName(staffBranchMaster, branches ?? []) : staffBranch?.branchName ?? "—";

  const canReadActivity = !!profile?.is_active && ["OWNER", "ADMIN"].includes(profile.role)
    && bolehBukaPath(profile.role, "/perusahaan/log-aktifitas", aksesModul ?? []);

  return (
    <ActivityNavigationProvider allowed={canReadActivity}><DraftUserProvider userId={user.id}><div className="shell">
      <NavigationFeedback />
      <Suspense fallback={null}><TransactionDraftComplete userId={user.id} /></Suspense>
      {!isStaff && (
        <Sidebar
          branches={branches ?? []}
          fullName={profile?.full_name ?? user.email ?? "Pengguna"}
          role={profile?.role ?? "—"}
          aksesModul={aksesModul ?? []}
        />
      )}
      <div className="main">
        <ReleaseNotice version={process.env.VERCEL_GIT_COMMIT_SHA ?? "local"} />
        {isStaff ? (
          <KlinikTopbar fullName={profile?.full_name ?? "Staff"} branchName={staffBranchName} />
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
        {activeBranch}
        <div className="ct"><ActivityMenuLink />{children}</div>
      </div>
    </div></DraftUserProvider></ActivityNavigationProvider>
  );
}
