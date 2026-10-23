import { labelPath, type KategoriRow } from './kategori';
import type { MultiSelectCategory, MultiSelectItem } from '@/components/SearchableMultiSelect';
export const UNCATEGORIZED = '__uncategorized';
export const UNAVAILABLE_CATEGORY = '__unavailable_category';
export type PromoCategoryItem = { id: string; code: string; name: string; category_id: string | null };

/** Informational current master labels; never a new eligibility rule. */
export function promoCategoryOptions(rows: KategoriRow[]): MultiSelectCategory[] {
  const byId = new Map(rows.map(row => [row.id, row]));
  const groups = new Map(rows.map(row => [row.id, { id: row.id, label: labelPath(row.id, rows), includes: [] as string[] }]));
  for (const row of rows) {
    let current: string | null = row.id;
    const seen = new Set<string>();
    let inactive = false, incomplete = false;
    while (current) {
      if (seen.has(current) || !byId.has(current)) { incomplete = true; break; }
      seen.add(current);
      const ancestor: KategoriRow = byId.get(current)!;
      inactive ||= !ancestor.is_active;
      groups.get(current)!.includes.push(row.id);
      current = ancestor.parent_id;
    }
    const group = groups.get(row.id)!;
    if (inactive) group.label += ' (nonaktif)';
    if (incomplete) group.label += ' (hierarki tidak lengkap)';
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'id')).concat([
    { id: UNCATEGORIZED, label: 'Tanpa kategori', includes: [''] },
    { id: UNAVAILABLE_CATEGORY, label: 'Kategori tidak tersedia', includes: [UNAVAILABLE_CATEGORY] },
  ]);
}
export function promoCategoryItem(item: PromoCategoryItem, categories: MultiSelectCategory[]): MultiSelectItem {
  const group = item.category_id ? categories.find(c => c.id === item.category_id) : categories.find(c => c.id === UNCATEGORIZED);
  return { id: item.id, code: item.code, name: item.name, categoryId: group ? (item.category_id ?? '') : UNAVAILABLE_CATEGORY, categoryLabel: group?.label ?? 'Kategori tidak tersedia' };
}
export function promoCategorySummary(targets: string[], items: Map<string, MultiSelectItem>): string[] {
  if (!targets.length) return ['Semua kategori'];
  return [...new Set(targets.map(id => items.get(id)?.categoryLabel ?? 'Kategori tidak tersedia'))].sort((a, b) => a.localeCompare(b, 'id'));
}
export function promoMatchesCategory(targets: string[], items: Map<string, MultiSelectItem>, category: MultiSelectCategory): boolean {
  return !targets.length || targets.some(id => category.includes.includes(items.get(id)?.categoryId ?? UNAVAILABLE_CATEGORY));
}
