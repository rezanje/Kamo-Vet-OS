import { completeReportQuery } from "./report-query";

type SaleItemGrooming = { id: string; qty: number | string | null };

/**
 * R06 (keputusan 29 Okt): grooming units sold through the POS cashier in a WIB day window
 * [from, until). Grooming = master item `Jasa` with saved category `Grooming` (the same rule
 * S05 uses to require a groomer). Voided sales are excluded. Branch scope comes from the
 * sales RLS of the signed-in client. Every page is read against an exact count, so the sum
 * is never cut at the 1000-row API limit.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function hitungGroomingKasir(supabase: any, from: string, until: string): Promise<number> {
  const { data } = await completeReportQuery<SaleItemGrooming>(supabase.from("sale_items")
    .select("id, qty, sales!inner(created_at, voided_at), items!inner(item_type, tindakan_kategori)", { count: "exact" })
    .eq("items.item_type", "Jasa").eq("items.tindakan_kategori", "Grooming")
    .is("sales.voided_at", null)
    .gte("sales.created_at", from).lt("sales.created_at", until));
  const total = data.reduce((sum, row) => sum + Number(row.qty ?? 0), 0);
  return Math.round(total * 10_000) / 10_000;
}
