import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BRANCH_HEADER, MODE_HEADER, branchSelectionUrl } from "./operational-context";
import { resolveOperationalBranch } from "./operational-branch";
import type { ShiftType } from "./shift";

export async function requireOperationalBranch(
  client: Parameters<typeof resolveOperationalBranch>[0], userId: string, mode: ShiftType,
) {
  const requestHeaders = await headers();
  const branchId = requestHeaders.get(BRANCH_HEADER) ?? "";
  if (requestHeaders.get(MODE_HEADER) !== mode) redirect(branchSelectionUrl(mode));
  const branch = await resolveOperationalBranch(client, userId, mode, branchId);
  if (!branch) redirect(branchSelectionUrl(mode));
  return branch;
}
