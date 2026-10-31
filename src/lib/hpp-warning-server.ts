import { priceFloorFindings } from "./cashier-price-floor";
import { hppWarningsFrom, type HppWarning } from "./hpp-warning";
import { quoteSaleLineCosts } from "./sale-fifo-quote";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
type BarisGrosir = { nama: string; item_id?: string | null; qty: number; harga: number; faktor?: number };

/**
 * P03: baris grosir (pesanan / faktur langsung) yang harga jualnya nol atau di bawah perkiraan
 * HPP FIFO gudang pengirim. Hanya untuk peringatan; tidak pernah memblokir. Bila HPP tidak
 * terbaca, hasilnya kosong (HPP riil tetap diakui saat pengiriman).
 */
export async function grosirHppWarnings(supabase: AnyClient, warehouseId: string | null, baris: BarisGrosir[]): Promise<HppWarning[]> {
  const itemIds = [...new Set(baris.flatMap((b) => (b.item_id ? [b.item_id] : [])))];
  if (!warehouseId || itemIds.length === 0) return [];
  try {
    const { data, error } = await supabase.from("items").select("id, item_type").in("id", itemIds);
    if (error) throw new Error(error.message);
    const typeOf = new Map(((data ?? []) as { id: string; item_type: string }[]).map((row) => [row.id, row.item_type]));
    const lines = baris.map((b) => ({
      nama: b.nama, item_id: b.item_id ?? null, item_type: b.item_id ? typeOf.get(b.item_id) : undefined,
      qty: Number(b.qty), harga: Number(b.harga), faktor: Number(b.faktor ?? 1) || 1,
    }));
    if (!lines.some((line) => line.item_type === "Persediaan")) return [];
    const costs = await quoteSaleLineCosts(supabase, warehouseId, lines);
    const net = lines.reduce((sum, line) => sum + line.qty * line.harga, 0);
    return hppWarningsFrom(priceFloorFindings(lines, net, costs));
  } catch (error) {
    console.error("[grosir] perkiraan HPP gagal dibaca:", error);
    return [];
  }
}
