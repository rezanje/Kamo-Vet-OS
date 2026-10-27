import { loadWarehouseStock, type WarehouseStock } from "@/lib/warehouse-stock";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadItemUnits, unitOptions } from "@/lib/satuan";
import { POForm, type Item } from "./POForm";
import { readCompleteList } from "@/lib/checked-list";

type CatalogItem = { id: string; code: string; name: string; unit: string; sell_price: number; buy_price: number; item_type: string };

// ponytail: create PO page — server component fetches suppliers, warehouses, branches.

export default async function BaruPOPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; harga_cek?: string }>;
}) {
  const { error, harga_cek } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [suppliers, warehouses, branches, items] = await Promise.all([
    readCompleteList<{ id: string; nama: string }>((from, to) => supabase.from("suppliers")
      .select("id, nama", { count: "exact" }).eq("is_active", true).order("nama").order("id").range(from, to), "Pemasok PO", { maxRows: null }),
    readCompleteList<{ id: string; name: string }>((from, to) => supabase.from("warehouses")
      .select("id, name", { count: "exact" }).order("name").order("id").range(from, to), "Gudang PO", { maxRows: null }),
    readCompleteList<{ id: string; name: string }>((from, to) => supabase.from("branches")
      .select("id, name", { count: "exact" }).order("name").order("id").range(from, to), "Cabang PO", { maxRows: null }),
    readCompleteList<CatalogItem>((from, to) => supabase.from("items")
      .select("id, code, name, unit, sell_price, buy_price, item_type", { count: "exact" })
      .eq("is_active", true).order("name").order("id").range(from, to),
      "Daftar barang PO", { maxRows: null }),
  ]);

  const stock: WarehouseStock[] = [];
  for (let start = 0; start < warehouses.length; start += 200) {
    stock.push(...await loadWarehouseStock(supabase, warehouses.slice(start, start + 200).map(w => w.id)));
  }

  // Satuan berjenjang: PO bisa dibuat per box/sak, stok tetap masuk dalam satuan dasar.
  const unitMap = await loadItemUnits(supabase, (items ?? []).map((i) => i.id as string));
  const katalog: Item[] = (items ?? []).map((i) => ({
    id: i.id as string,
    code: i.code as string,
    name: i.name as string,
    unit: i.unit as string,
    buy_price: Number(i.buy_price),
    item_type: i.item_type,
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

      <POForm userId={user?.id ?? ""}
        suppliers={suppliers ?? []}
        warehouses={warehouses ?? []}
        branches={branches ?? []}
        items={katalog}
        stock={stock}
        priceWarning={harga_cek}
      />
    </>
  );
}
