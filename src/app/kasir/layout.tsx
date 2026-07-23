import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { notificationActiveFor, type NotificationRow } from "@/lib/notifications";
import { PosNav } from "./PosNav";
import { NotifBanner } from "./NotifBanner";

// Dunia POS kasir: shell sendiri (tanpa sidebar VetOS), top-nav Kasir/Pengeluaran/Persediaan.
export default async function KasirLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name, is_active").eq("id", user.id).maybeSingle();
  if (profile && profile.is_active === false) {
    await supabase.auth.signOut();
    redirect("/login?error=" + encodeURIComponent("Akun Anda dinonaktifkan. Hubungi admin."));
  }
  const shift = await getOpenShift(supabase as never, user.id);

  let notifications: NotificationRow[] = [];
  if (shift) {
    const { data } = await supabase
      .from("notifications").select("id, title, message, type, is_active, branch_ids").eq("is_active", true).order("created_at", { ascending: false });
    notifications = ((data ?? []) as NotificationRow[]).filter((n) => notificationActiveFor(n, shift.branch_id));
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <PosNav
        branchName={shift?.branchName ?? null}
        userName={(profile?.full_name ?? user.email ?? "Kasir").split(" ")[0]}
        hasShift={!!shift}
        notifications={notifications}
      />
      {shift && <NotifBanner notifications={notifications} />}
      <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>{children}</div>
    </div>
  );
}
