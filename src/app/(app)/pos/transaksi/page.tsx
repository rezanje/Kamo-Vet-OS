import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PosClient, type Item, type Cust } from "./PosClient";

export default async function TransaksiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: items }, { data: customers }, { data: branches }] = await Promise.all([
    supabase.from("items").select("id, name, sell_price, target_species").eq("is_active", true).order("name"),
    supabase.from("customers").select("id, name, phone, points, pets(id, name, species)").order("name"),
    supabase.from("branches").select("id, code, name").eq("is_active", true).order("name"),
  ]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Transaksi POS</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <PosClient
        items={(items ?? []) as Item[]}
        customers={(customers ?? []) as unknown as Cust[]}
        branches={branches ?? []}
      />
    </>
  );
}
