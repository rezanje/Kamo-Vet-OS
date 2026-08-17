import { createClient } from "@/lib/supabase/server";
import { HitungForm, type BarisHitung } from "./HitungForm";

// Penyedia data layar hitung. Yang dikirim ke peramban hanya identitas barang dan
// harga jualnya — angka stok sistem TIDAK ikut, supaya petugas hitung tidak bisa
// menyesuaikan hitungannya dengan angka sistem (keputusan meeting 14 Agustus).
export async function DaftarHitung({ orderId, warehouseId }: { orderId: string; warehouseId: string }) {
  const supabase = await createClient();

  const { data: lingkupRows } = await supabase
    .from("opname_order_items").select("item_id").eq("order_id", orderId);
  const lingkup = (lingkupRows ?? []).map((r) => r.item_id as string);

  let q = supabase
    .from("stock")
    .select("item_id, items(code, name, unit, sell_price, item_categories(name))")
    .eq("warehouse_id", warehouseId);
  if (lingkup.length > 0) q = q.in("item_id", lingkup);

  const [{ data: stokRows }, { data: kunciRows }] = await Promise.all([
    q,
    supabase.from("opname_counts").select("item_id, qty_fisik").eq("order_id", orderId),
  ]);

  type StokRow = {
    item_id: string;
    items: {
      code: string; name: string; unit: string | null; sell_price: number;
      item_categories: { name: string } | { name: string }[] | null;
    } | null;
  };

  const rows: BarisHitung[] = ((stokRows ?? []) as unknown as StokRow[])
    .filter((s) => s.items)
    .map((s) => {
      const kat = Array.isArray(s.items!.item_categories) ? s.items!.item_categories[0] : s.items!.item_categories;
      return {
        item_id: s.item_id,
        code: s.items!.code,
        name: s.items!.name,
        unit: s.items!.unit ?? "",
        kategori: kat?.name ?? "Tanpa kategori",
        sell_price: Number(s.items!.sell_price) || 0,
      };
    });

  const terkunci = Object.fromEntries(
    ((kunciRows ?? []) as { item_id: string; qty_fisik: number }[]).map((r) => [r.item_id, Number(r.qty_fisik)]),
  );

  return <HitungForm orderId={orderId} rows={rows} terkunci={terkunci} />;
}
