import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { PosNav } from "./PosNav";

// Dunia POS kasir: shell sendiri (tanpa sidebar VetOS), top-nav Kasir/Pengeluaran/Persediaan.
export default async function KasirLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const shift = await getOpenShift(supabase as never, user.id);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <PosNav
        branchName={shift?.branchName ?? null}
        userName={(profile?.full_name ?? user.email ?? "Kasir").split(" ")[0]}
        hasShift={!!shift}
      />
      <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>{children}</div>
    </div>
  );
}
