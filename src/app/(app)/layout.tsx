import { ActivityNavigationProvider } from "@/components/ActivityHistoryLink";
import { ActivityMenuLink } from "@/components/ActivityMenuLink";
import { bolehBukaPath, roleUsesLegacyStaffShell } from "@/lib/akses";
import { aturanEfektif, bacaAkses } from "@/lib/akses-akun";
import { RoleMenuProvider } from "@/components/RoleMenuContext";
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
  // Kebijakan sub-menu dan akses khusus akun (E3, meeting 12 Nov 2026) ikut dibaca bersamaan lewat pembaca bersama;
  // hanya untuk tampilan (middleware yang menegakkan) — daftar yang sama dengan middleware.
  const aksesP = mulai(bacaAkses(supabase));
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

  const [{ data: branches }, akses] = await Promise.all([branchesP, aksesP]);
  const aksesModul = akses.rules ? aturanEfektif(profile?.role ?? "STAFF", akses) : akses.rules;

  // STAFF cuma masuk (app) lewat alur kasir klinik (/klinik/shift & seterusnya) —
  // sidebar admin (Keuangan, HRIS, Pengaturan, dst) bukan buat mereka.
  // E3: STAFF dengan akses khusus akun selalu berbentuk v2 (lihat terapkanAksesAkun), jadi memakai sidebar biasa
  // yang berisi menu yang dicentang Owner, bukan tampilan kasir klinik lama.
  const isStaff = profile?.role === "STAFF";
  const legacyStaffShell = roleUsesLegacyStaffShell(profile?.role ?? "STAFF", aksesModul ?? []);
  const staffBranch = isStaff ? await staffShiftP : null;
  const activeBranch = await ActiveBranch({ catalog: branches ?? [] });
  const staffBranchMaster = branches?.find(branch => branch.id === staffBranch?.branch_id);
  const staffBranchName = staffBranchMaster ? branchDisplayName(staffBranchMaster, branches ?? []) : staffBranch?.branchName ?? "—";

  const canReadActivity = !!profile?.is_active && ["OWNER", "ADMIN"].includes(profile.role)
    && bolehBukaPath(profile.role, "/perusahaan/log-aktifitas", aksesModul ?? []);

  return (
    <ActivityNavigationProvider allowed={canReadActivity}><RoleMenuProvider role={profile?.role ?? "STAFF"} rules={aksesModul ?? []}><DraftUserProvider userId={user.id}><div className="shell">
      <NavigationFeedback />
      <Suspense fallback={null}><TransactionDraftComplete userId={user.id} /></Suspense>
      {!legacyStaffShell && (
        <Sidebar
          branches={branches ?? []}
          fullName={profile?.full_name ?? user.email ?? "Pengguna"}
          role={profile?.role ?? "—"}
          aksesModul={aksesModul ?? []}
        />
      )}
      <div className="main">
        <ReleaseNotice version={process.env.VERCEL_GIT_COMMIT_SHA ?? "local"} />
        {legacyStaffShell ? (
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
    </div></DraftUserProvider></RoleMenuProvider></ActivityNavigationProvider>
  );
}
