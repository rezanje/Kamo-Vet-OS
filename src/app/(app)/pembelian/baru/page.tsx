import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadItemUnits, unitOptions } from "@/lib/satuan";
import { POForm, type Item } from "./POForm";

// ponytail: create PO page — server component fetches suppliers, warehouses, branches.

export default async function BaruPOPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: suppliers }, { data: warehouses }, { data: branches }, { data: items }] = await Promise.all([
    supabase.from("suppliers").select("id, nama").order("nama"),
    supabase.from("warehouses").select("id, name").order("name"),
    supabase.from("branches").select("id, name").order("name"),
    supabase.from("items").select("id, code, name, unit, sell_price, buy_price").eq("is_active", true).order("name"),
  ]);

  // Satuan berjenjang: PO bisa dibuat per box/sak, stok tetap masuk dalam satuan dasar.
  const unitMap = await loadItemUnits(supabase, (items ?? []).map((i) => i.id as string));
  const katalog: Item[] = (items ?? []).map((i) => ({
    id: i.id as string,
    code: i.code as string,
    name: i.name as string,
    unit: i.unit as string,
    buy_price: Number(i.buy_price),
    units: unitOptions(
      { unit: i.unit as string, sell_price: Number(i.sell_price), buy_price: Number(i.buy_price) },
      unitMap.get(i.id as string) ?? [],
    ),
  }));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pembelian" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Buat Purchase Order</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <POForm
        suppliers={suppliers ?? []}
        warehouses={warehouses ?? []}
        branches={branches ?? []}
        items={katalog}
      />
    </>
  );
}
