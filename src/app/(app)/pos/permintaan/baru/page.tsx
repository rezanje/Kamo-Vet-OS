import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PermintaanForm } from "./PermintaanForm";

export default async function BaruPermintaanPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: branches } = await supabase
    .from("branches")
    .select("id, name")
    .order("name");
  const { data: warehouses } = await supabase
    .from("warehouses")
    .select("id, name")
    .order("name");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos/permintaan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Buat Permintaan Barang</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <PermintaanForm branches={branches ?? []} warehouses={warehouses ?? []} />
    </>
  );
}
