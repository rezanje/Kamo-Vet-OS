import type { AccurateItem, ExistingAccurateCategory, ExistingAccurateItem } from "./impor-accurate";

/** Only obsolete categories reached through existing products in this import. */
export function kategoriTergantikan(
  incoming: AccurateItem[],
  existingItems: ExistingAccurateItem[],
  categories: ExistingAccurateCategory[],
  protectedNames: string[],
): string[] {
  const key = (value: string) => value.trim().toLowerCase();
  const byName = new Map(categories.map(row => [key(row.name), row]));
  const byId = new Map(categories.map(row => [row.id, row]));
  const keep = new Set(protectedNames.map(key));
  const byCode = new Map(incoming.map(row => [key(row.code), row]));
  const candidates = new Set<string>();
  const ancestors = (id: string): string[] => {
    const result: string[] = [];
    let current: string | null = id;
    while (current && !result.includes(current)) {
      result.push(current);
      current = byId.get(current)?.parent_id ?? null;
    }
    return result;
  };
  for (const item of existingItems) {
    const replacement = byCode.get(key(item.code));
    const old = byName.get(key(item.category_name));
    if (old && replacement && key(replacement.category_name) !== key(old.name)) {
      ancestors(old.id).forEach(id => { if (!keep.has(key(byId.get(id)!.name))) candidates.add(id); });
    }
  }
  // Include already-empty children only when the entire old branch is replaced.
  // Partial imports must not remove unrelated, preconfigured empty categories.
  for (const id of [...candidates]) {
    const branch = categories.filter(row => ancestors(row.id).includes(id));
    const names = new Set(branch.map(row => key(row.name)));
    const members = existingItems.filter(item => names.has(key(item.category_name)));
    if (members.length && members.every(item => {
      const next = byCode.get(key(item.code));
      return next && !names.has(key(next.category_name));
    })) {
      branch.forEach(row => { if (!keep.has(key(row.name))) candidates.add(row.id); });
    }
  }
  return [...candidates].sort((a, b) => ancestors(b).length - ancestors(a).length);
}
