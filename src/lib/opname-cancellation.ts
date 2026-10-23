import type { createClient } from "@/lib/supabase/server";
import { allowedBranchIds } from "./branch-access";
type Db = Awaited<ReturnType<typeof createClient>>;
export type OpnameCancellation = {
  id: string; status: string; cancelled_at: string | null; cancelled_by: string | null;
  cancelled_by_name: string | null; cancel_reason: string | null;
};
export async function opnameWarehouseIds(db: Db, userId: string): Promise<string[]> {
  const allowed = await allowedBranchIds(db, userId);
  if (allowed?.length === 0) return [];
  let q = db.from("warehouses").select("id");
  if (allowed) q = q.in("branch_id", allowed);
  const { data, error } = await q;
  if (error) throw new Error("Akses gudang opname belum dapat diverifikasi.");
  return (data ?? []).map(row => String(row.id));
}
export async function opnameCancellationBlock(db: Db, id: string): Promise<string | null> {
  const [counts, results] = await Promise.all([
    db.from("opname_counts").select("id", { count: "exact", head: true }).eq("order_id", id),
    db.from("opname_results").select("id", { count: "exact", head: true }).eq("order_id", id),
  ]);
  if (counts.error || results.error || counts.count == null || results.count == null) return "Status draf belum dapat diverifikasi. Muat ulang sebelum membatalkan.";
  if (counts.count > 0) return "Sudah ada hitungan terkunci. Pembatalan draf ditolak; periksa hitungan yang sudah disimpan.";
  if (results.count > 0) return "Sudah ada hasil atau proses posting opname. Pembatalan draf ditolak; periksa hasil asal.";
  return null;
}
