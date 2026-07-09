import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { PermintaanFormKlinik } from "./PermintaanFormKlinik";

export default async function KlinikPermintaanBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const shift = await getOpenShift(supabase as never, user.id, "klinik");
  if (!shift) redirect("/klinik/shift");

  // Gudang tujuan: semua gudang aktif (DC/pusat + gudang cabang lain).
  const { data: warehouses } = await supabase
    .from("warehouses").select("id, name").eq("is_active", true).order("name");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik/permintaan" className="back-btn"><i className="ti ti-arrow-left" /> Permintaan Barang</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Permintaan Baru</span>
      </div>
      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      <PermintaanFormKlinik branchName={shift.branchName} warehouses={warehouses ?? []} />
    </>
  );
}
