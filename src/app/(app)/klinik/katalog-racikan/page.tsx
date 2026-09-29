import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadKatalogRacikan } from "@/lib/katalog-racikan-server";
import { SecHeader } from "@/components/SecHeader";
import { KatalogForm } from "./KatalogForm";

export default async function KatalogRacikanPage({ searchParams }: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["OWNER", "ADMIN"].includes(profile.role)) redirect("/klinik");
  const katalog = await loadKatalogRacikan(true);
  const { data: items, error: itemError } = await supabase.from("items")
    .select("id, name, unit, sell_price")
    .eq("is_active", true).eq("item_type", "Persediaan")
    .eq("is_compound_material", true).order("name").limit(1000);
  if (itemError) throw new Error("Bahan baku tidak dapat dimuat.");
  return <>
    <div style={{ marginBottom: 12 }}>
      <Link href="/klinik/racik" className="back-btn"><i className="ti ti-arrow-left" /> Racik Obat</Link>
    </div>
    <div className="crm-sec">
      <SecHeader num="01" title="KATALOG RACIKAN RESMI" desc="OWNER/ADMIN menerbitkan revisi; resep lama tetap memakai versi saat dibuat." />
      {error && <div className="p2ban" style={{ color: "#b91c1c" }}>{error}</div>}
      {success && <div className="p2ban" style={{ color: "#15803d" }}>Katalog berhasil diperbarui.</div>}
      <KatalogForm katalog={katalog} items={(items ?? []).map((item) => ({
        id: item.id, name: item.name, unit: item.unit, sell_price: Number(item.sell_price),
      }))} />
    </div>
  </>;
}
