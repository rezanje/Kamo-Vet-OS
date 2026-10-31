export type QuantityPoolRule = {
  version: 1;
  unit: "PCS";
  normal_price: number;
  tiers: { qty: number; total: number }[];
};

/** Strict JSON reader: absent/partial/new-version rules never become legacy money. */
export function parseQuantityPoolRule(value: unknown): QuantityPoolRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  // V1 is deliberately the reviewed Bolt/CatChoize contract, not a general
  // greedy-pricing language. Match the DB's exact JSON shape (key order aside).
  if (Object.keys(r).length !== 4 || r.version !== 1 || r.unit !== "PCS" || r.normal_price !== 20000 ||
    !Array.isArray(r.tiers) || r.tiers.length !== 2) return null;
  const tiers: QuantityPoolRule["tiers"] = [];
  for (const [index, value] of r.tiers.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const t = value as Record<string, unknown>;
    if (Object.keys(t).length !== 2 || t.qty !== (index === 0 ? 6 : 2) || t.total !== (index === 0 ? 110000 : 38000)) return null;
    tiers.push({qty: Number(t.qty), total: Number(t.total)});
  }
  return {version: 1, unit: "PCS", normal_price: 20000, tiers};
}

/** Allocation keys are source-row identities, never product/SKU identities. */
export function allocateQuantityPool(rule: QuantityPoolRule, lines: { id: string; qty: number }[]): Record<string, number> {
  if (!parseQuantityPoolRule(rule) || lines.some(line => !line.id || !Number.isSafeInteger(line.qty) || line.qty <= 0) ||
    new Set(lines.map(line => line.id)).size !== lines.length) throw new Error("Aturan atau baris quantity pool tidak valid");
  const qty = lines.reduce((sum, line) => sum + line.qty, 0);
  if (!Number.isSafeInteger(qty * rule.normal_price)) throw new Error("Nilai quantity pool melebihi batas aman");
  if (qty <= 0) return {};
  let remaining = qty, discount = 0;
  for (const tier of [...rule.tiers].sort((a, b) => b.qty - a.qty)) {
    const count = Math.floor(remaining / tier.qty);
    discount += count * (rule.normal_price * tier.qty - tier.total);
    remaining -= count * tier.qty;
  }
  // Integer products avoid floating-point ties/rounding. Persisted source input
  // position is the tie breaker; never sort by SKU, UUID or synthetic row name.
  const parts = lines.map((line, index) => {
    const product = BigInt(discount) * BigInt(line.qty);
    return {id: line.id, index, amount: Number(product / BigInt(qty)), remainder: product % BigInt(qty)};
  });
  const left = discount - parts.reduce((sum, part) => sum + part.amount, 0);
  const ranked = [...parts].sort((a, b) => a.remainder === b.remainder
    ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < left; i++) ranked[i].amount++;
  return Object.fromEntries(parts.map(part => [part.id, part.amount]));
}
