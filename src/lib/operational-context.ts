import type { ShiftType } from "./shift";

export const BRANCH_HEADER = "x-kamo-operational-branch";
export const MODE_HEADER = "x-kamo-operational-mode";
export const branchCookie = (mode: ShiftType) => `kamo-branch-${mode}`;
export type BranchContext = { userId: string; branchId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function operationalMode(path: string): ShiftType | null {
  if (path === "/kasir" || path.startsWith("/kasir/")) return "petshop";
  if (path === "/klinik" || path.startsWith("/klinik/")) return "klinik";
  return null;
}
export function parseBranchContext(value: string | undefined, userId: string): BranchContext | null {
  try {
    const parsed = JSON.parse(value ?? "null");
    return parsed?.userId === userId && typeof parsed.branchId === "string" && uuid.test(parsed.branchId)
      ? { userId, branchId: parsed.branchId } : null;
  } catch { return null; }
}
export function branchTypeMatches(type: string, mode: ShiftType) {
  return type === "BOTH" || type === (mode === "klinik" ? "KLINIK" : "PETSHOP");
}
export const branchSelectionUrl = (mode: ShiftType) => `/mulai/cabang?mode=${mode}`;
