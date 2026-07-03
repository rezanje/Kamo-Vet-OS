import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RacikanForm, type ItemOpt } from "./RacikanForm";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

// Form buat racikan baru — reference medical_record kunjungan ini (Addendum §2).
export default async function RacikanBaruPage({
  params,
  searchParams,
}: {
  params: Promise<{ visitId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { visitId } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: visit } = await supabase
    .from("visits")
    .select("id, poli, pets(name, species), customers(name)")
    .eq("id", visitId).maybeSingle();
  if (!visit) notFound();

  const { data: mr } = await supabase
    .from("medical_records").select("id").eq("visit_id", visitId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!mr) redirect(`/klinik/rekam-medis/${visitId}?error=${encodeURIComponent("Simpan rekam medis dulu sebelum buat racikan")}`);

  const { data: items } = await supabase
    .from("items").select("id, name, unit").eq("is_active", true).order("name");

  const pet = one(visit.pets);
  const cust = one(visit.customers);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href={`/klinik/rekam-medis/${visitId}`} className="back-btn"><i className="ti ti-arrow-left" /> Rekam Medis</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Racikan Baru — {pet?.name ?? "—"} ({cust?.name ?? "—"})</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <RacikanForm visitId={visitId} medicalRecordId={mr!.id} items={(items ?? []) as ItemOpt[]} />
    </>
  );
}
