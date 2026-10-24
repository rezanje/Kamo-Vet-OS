import { createClient } from "@/lib/supabase/server";
import { readCompleteList, ListLoadError } from "@/lib/checked-list";
import { HitungForm, type BarisHitung } from "./HitungForm";

// Penyedia data layar hitung. Yang dikirim ke peramban hanya identitas barang dan
// harga jualnya — angka stok sistem TIDAK ikut, supaya petugas hitung tidak bisa
// menyesuaikan hitungannya dengan angka sistem (keputusan meeting 14 Agustus).
export async function DaftarHitung({ orderId, warehouseId }: { orderId: string; warehouseId: string }) {
  const supabase = await createClient();

  type CountItem = {
    code: string; name: string; unit: string | null; sell_price: number;
    item_categories: { name: string } | { name: string }[] | null;
  };
  type CountSource = { id: string; item_id: string; items: CountItem | CountItem[] | null };

  const lingkupRows = await readCompleteList<CountSource>((from, to) => supabase
    .from("opname_order_items")
    .select("id,item_id,items(code,name,unit,sell_price,item_categories(name))", { count: "exact" })
    .eq("order_id", orderId).order("id").range(from, to), "Lingkup opname");
  // A scoped zero-stock SKU may have no stock row yet; read its item from the
  // order itself. Only an unrestricted count uses the warehouse stock list.
  const sourceRows = lingkupRows.length ? lingkupRows : await readCompleteList<CountSource>((from, to) => supabase
    .from("stock")
    .select("id,item_id,items(code,name,unit,sell_price,item_categories(name))", { count: "exact" })
    .eq("warehouse_id", warehouseId).order("id").range(from, to), "Stok gudang opname");
  if (sourceRows.some((row) => !row.items || (Array.isArray(row.items) && row.items.length !== 1))) {
    throw new ListLoadError("Barang dalam lingkup opname belum dapat dimuat lengkap. Coba muat ulang.");
  }
  const kunciRows = await readCompleteList<{ id: string; item_id: string; qty_fisik: number }>((from, to) => supabase
    .from("opname_counts").select("id,item_id,qty_fisik", { count: "exact" })
    .eq("order_id", orderId).order("id").range(from, to), "Hitungan terkunci");

  const rows: BarisHitung[] = sourceRows
    .map((s) => {
      const item = Array.isArray(s.items) ? s.items[0] : s.items!;
      const kat = Array.isArray(item.item_categories) ? item.item_categories[0] : item.item_categories;
      return {
        item_id: s.item_id,
        code: item.code,
        name: item.name,
        unit: item.unit ?? "",
        kategori: kat?.name ?? "Tanpa kategori",
        sell_price: Number(item.sell_price) || 0,
      };
    });

  const terkunci = Object.fromEntries(
    kunciRows.map((r) => [r.item_id, Number(r.qty_fisik)]),
  );

  return <HitungForm key={orderId} orderId={orderId} rows={rows} terkunci={terkunci} />;
}
