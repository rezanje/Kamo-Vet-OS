// Cabang mana yang boleh dipakai satu akun (pilihan cabang saat buka shift).
// RLS transaksi POS sengaja dilonggarkan untuk demo (0025_demo_relax_txn), jadi
// pembatasan cabang ditegakkan di layer aplikasi — jangan andalkan RLS di sini.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// ADMIN wajib mengikuti user_branches. Hanya pemilik dan fungsi keuangan yang
// memang bekerja lintas badan usaha tetap company-wide.
const GLOBAL_ROLES = ["OWNER", "FINANCE"];

export function isCompanyWideRole(role: string): boolean {
  return GLOBAL_ROLES.includes(role);
}

// null = bebas semua cabang. Array = daftar cabang penempatan (boleh kosong).
export type AllowedBranches = string[] | null;

export function canUseBranch(allowed: AllowedBranches, branchId: string): boolean {
  if (allowed === null) return true;
  return allowed.includes(branchId);
}

export async function allowedBranchIds(supabase: AnyClient, userId: string): Promise<AllowedBranches> {
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (isCompanyWideRole(String(prof?.role ?? ""))) return null;

  const { data } = await supabase.from("user_branches").select("branch_id").eq("user_id", userId);
  return (data ?? []).map((r: { branch_id: string }) => String(r.branch_id));
}
