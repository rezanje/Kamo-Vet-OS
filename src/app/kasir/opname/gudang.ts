import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Gudang milik cabang ini — sama seperti yang dipotong saat kasir menjual
 * (`checkout.ts`), supaya yang dihitung fisik persis stok yang dipakai jualan.
 */
export async function gudangCabang(supabase: Db, branchId: string) {
  const { data } = await supabase
    .from("warehouses").select("id, name")
    .eq("branch_id", branchId).eq("is_active", true)
    .order("type").limit(1).maybeSingle();
  return data;
}
