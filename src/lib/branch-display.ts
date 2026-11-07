export type BranchForDisplay = { code?: string | null; name: string; type?: string | null };

export function branchDisplayName(branch: BranchForDisplay, catalog: BranchForDisplay[]): string {
  if (branch.type !== "KLINIK" && branch.type !== "BOTH") return branch.name;
  const pairedCode = branch.code?.startsWith("VET_") ? branch.code.slice(4) : null;
  const paired = pairedCode ? catalog.find(row => row.code === pairedCode && row.type === "PETSHOP") : null;
  const name = paired?.name ?? branch.name;
  return name.endsWith(" · Vet") ? name : `${name} · Vet`;
}

/**
 * Label pilihan yang ramah pengguna: cukup nama. Potongan ID internal tidak ditampilkan.
 * Bila ada nama kembar, label diberi nomor urut "(2)", "(3)", dst. supaya tetap bisa dibedakan.
 */
export function uniqueOptionLabels<T extends { id: string }>(rows: T[], nameOf: (row: T) => string): Map<string, string> {
  const total = new Map<string, number>();
  for (const row of rows) total.set(nameOf(row), (total.get(nameOf(row)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const row of rows) {
    const name = nameOf(row);
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    labels.set(row.id, (total.get(name) ?? 0) > 1 && n > 1 ? `${name} (${n})` : name);
  }
  return labels;
}
