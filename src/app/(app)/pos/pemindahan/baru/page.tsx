import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PemindahanForm } from "./PemindahanForm";

export default async function PemindahanBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: whs }, { data: items }] = await Promise.all([
    supabase.from("warehouses").select("id, name").eq("is_active", true).neq("type", "TRANSIT").order("name"),
    supabase.from("items").select("id, code, name, unit").eq("is_active", true).order("name"),
  ]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos/pemindahan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Kirim Barang</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <PemindahanForm warehouses={whs ?? []} items={items ?? []} />
    </>
  );
}
