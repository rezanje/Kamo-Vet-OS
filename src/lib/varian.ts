export type VariantMemberDraft = {
  itemId: string;
  itemType: string;
  label: string;
};

export function validateVariantMembers(rows: VariantMemberDraft[]): string | null {
  if (new Set(rows.map((row) => row.itemId)).size !== rows.length) return "SKU hanya boleh sekali";
  if (rows.some((row) => row.itemType === "Grup")) return "Grup tidak boleh menjadi anggota Varian";
  if (rows.length < 2) return "Keluarga Varian minimal dua SKU";
  if (rows.some((row) => !row.label.trim())) return "Label Varian wajib diisi";
  return null;
}

export function variantMemberPayload(rows: VariantMemberDraft[]) {
  return rows.map((row, sortOrder) => ({
    item_id: row.itemId,
    label: row.label.trim(),
    sort_order: sortOrder,
  }));
}
