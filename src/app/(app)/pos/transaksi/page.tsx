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

  const { data: { user } } = await supabase.auth.getUser();
  const { data: openShift } = await supabase
    .from("cashier_shifts").select("id").eq("opened_by", user?.id ?? "").eq("status", "open").maybeSingle();

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
      {!openShift && (
        <div className="p2ban" style={{ justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <i className="ti ti-clock-pause" /> Shift belum dibuka — penjualan tidak tercatat ke rekonsiliasi kas.
          </span>
          <Link href="/pos/shift" className="btn-acc" style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>Buka shift</Link>
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
