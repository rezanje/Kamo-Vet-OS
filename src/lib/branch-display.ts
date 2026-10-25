export type BranchForDisplay = { code?: string | null; name: string; type?: string | null };

export function branchDisplayName(branch: BranchForDisplay, catalog: BranchForDisplay[]): string {
  if (branch.type !== "KLINIK" && branch.type !== "BOTH") return branch.name;
  const pairedCode = branch.code?.startsWith("VET_") ? branch.code.slice(4) : null;
  const paired = pairedCode ? catalog.find(row => row.code === pairedCode && row.type === "PETSHOP") : null;
  const name = paired?.name ?? branch.name;
  return name.endsWith(" · Vet") ? name : `${name} · Vet`;
}
