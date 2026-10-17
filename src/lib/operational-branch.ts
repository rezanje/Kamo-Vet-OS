import { allowedBranchIds, canUseBranch } from "./branch-access";
import { ALL_BRANCHES, branchTypeMatches } from "./operational-context";
import type { ShiftType } from "./shift";
// Supabase clients and the existing lightweight test clients share this surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;
export type OperationalBranch = { id: string; name: string; code: string; type: string; is_active: boolean };

export async function availableOperationalBranches(client: Client, userId: string, mode: ShiftType): Promise<OperationalBranch[]> {
  const allowed = await allowedBranchIds(client, userId);
  if (allowed !== null && !allowed.length) return [];
  let query = client.from("branches").select("id, name, code, type, is_active")
    .eq("is_active", true).in("type", mode === "klinik" ? ["KLINIK", "BOTH"] : ["PETSHOP", "BOTH"]);
  if (allowed !== null) query = query.in("id", allowed);
  const { data, error } = await query.order("name");
  if (error) throw new Error("Cabang gagal dimuat. Coba lagi.");
  return data ?? [];
}

export async function resolveOperationalBranch(client: Client, userId: string, mode: ShiftType, branchId: string): Promise<OperationalBranch | null> {
  const allowed = await allowedBranchIds(client, userId);
  if (branchId === ALL_BRANCHES) {
    return mode === "klinik" && allowed === null
      ? { id: ALL_BRANCHES, name: "Semua cabang", code: "ALL", type: "KLINIK", is_active: true } : null;
  }
  if (!branchId || !canUseBranch(allowed, branchId)) return null;
  const { data, error } = await client.from("branches").select("id, name, code, type, is_active").eq("id", branchId).maybeSingle();
  if (error || !data?.is_active || !branchTypeMatches(data.type, mode)) return null;
  return data;
}
