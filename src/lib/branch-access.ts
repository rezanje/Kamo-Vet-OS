// Account grants remain distinct from HRIS work assignments.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// Peran yang lintas cabang: tidak diikat ke user_branches.
const GLOBAL_ROLES = ["OWNER", "ADMIN", "FINANCE"];

// null = bebas semua cabang. Array = daftar cabang penempatan (boleh kosong).
export type AllowedBranches = string[] | null;

export function canUseBranch(allowed: AllowedBranches, branchId: string): boolean {
  if (allowed === null) return true;
  return allowed.includes(branchId);
}

export async function allowedBranchIds(supabase: AnyClient, userId: string): Promise<AllowedBranches> {
  const { data: prof, error: profileError } = await supabase.from("profiles").select("role, is_active").eq("id", userId).maybeSingle();
  if (profileError || !prof || prof.is_active === false) return [];
  if (GLOBAL_ROLES.includes(String(prof?.role ?? ""))) return null;

  const { data, error } = await supabase.from("user_branches").select("branch_id").eq("user_id", userId);
  if (error) return [];
  return (data ?? []).map((r: { branch_id: string }) => String(r.branch_id));
}
