import { createClient } from "@/lib/supabase/server";
import { HasilForm } from "./HasilForm";

// Terbuka: form input hitungan fisik dari stok gudang saat ini.
// Opname parsial hanya menampilkan barang yang masuk lingkup perintah — barang di
// luar lingkup tidak boleh ikut disesuaikan, itu inti "parsial"-nya.
//
// Dipakai modul Persediaan DAN layar kasir; `kembali` hanya menentukan halaman
// tujuan setelah simpan.
export async function OpenForm({
  orderId,
  warehouseId,
  kembali,
}: {
  orderId: string;
  warehouseId: string;
  kembali?: "kasir";
}) {
  const supabase = await createClient();
  const { data: lingkupRows } = await supabase
    .from("opname_order_items").select("item_id").eq("order_id", orderId);
  const lingkup = (lingkupRows ?? []).map((r) => r.item_id as string);

  let q = supabase
    .from("stock")
    .select("item_id, qty, items(code, name, unit)")
    .eq("warehouse_id", warehouseId);
  if (lingkup.length > 0) q = q.in("item_id", lingkup);
  const { data } = await q;

  const rows = ((data ?? []) as unknown as { item_id: string; qty: number; items: { code: string; name: string; unit: string } | null }[])
    .map((s) => ({
      item_id: s.item_id,
      code: s.items?.code ?? "—",
      name: s.items?.name ?? "—",
      unit: s.items?.unit ?? "",
      qty_sistem: Number(s.qty),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return <HasilForm orderId={orderId} rows={rows} kembali={kembali} />;
}
