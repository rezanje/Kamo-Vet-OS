// Shift kasir yang sedang terbuka untuk user ini (gate POS mode).
type AnyClient = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type OpenShift = {
  id: string;
  branch_id: string;
  opening_balance: number;
  opened_at: string;
  branches: { name: string; code: string } | { name: string; code: string }[] | null;
};

export async function getOpenShift(supabase: AnyClient, userId: string): Promise<(OpenShift & { branchName: string }) | null> {
  const { data } = await supabase
    .from("cashier_shifts")
    .select("id, branch_id, opening_balance, opened_at, branches(name, code)")
    .eq("opened_by", userId)
    .eq("status", "open")
    .maybeSingle();
  if (!data) return null;
  const b = Array.isArray(data.branches) ? data.branches[0] : data.branches;
  return { ...data, branchName: b?.name ?? "—" };
}
