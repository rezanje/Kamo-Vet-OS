type PrintBranch = { name?: string | null; code?: string | null };

/** Only pass the issuing branch stored on the document, never the UI selection. */
export function printBranchHeading(branch: PrintBranch | null | undefined): string {
  return branch?.name?.trim() || branch?.code?.trim() || "Cabang belum tercatat";
}
