// Back-office POS stock is always taken from the branch's retail warehouse.
// An ONLINE warehouse must not become the default just because its type sorts first.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requirePosRetailWarehouse(supabase: any, branchId: string): Promise<string> {
  const { data, error } = await supabase.from("warehouses").select("id")
    .eq("branch_id", branchId).eq("type", "RETAIL").eq("is_active", true).maybeSingle();
  if (error || !data?.id) throw new Error("Gudang retail cabang tidak tersedia atau tidak unik");
  return String(data.id);
}
