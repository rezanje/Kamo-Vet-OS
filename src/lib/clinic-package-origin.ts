/** Explicit package intent only. Database validation remains authoritative for
 * recipe completeness, quantities/units, clinical role and branch before writes.
 * Never infer membership from names, prices or matching component recipes. */
export type ClinicPackageOrigin = { package_item_id?: string; package_qty?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (): never => { throw new Error("Asal paket tidak valid. Pilih ulang paket dan jumlahnya."); };

export function clinicPackageOriginInput(row: unknown): ClinicPackageOrigin {
  if (!row || typeof row !== "object" || Array.isArray(row)) return invalid();
  const input = row as Record<string, unknown>;
  const pair = (id: unknown, qty: unknown): ClinicPackageOrigin | null => {
    // Paired database NULLs (or absent UI fields) are ordinary legacy rows.
    if (id == null && qty == null) return null;
    if (typeof id !== "string" || !UUID.test(id) || typeof qty !== "number"
      || !Number.isSafeInteger(qty) || qty <= 0) return invalid();
    return { package_item_id: id, package_qty: qty };
  };
  const canonical = pair(input.package_item_id, input.package_qty);
  const alias = pair(input.paket_id, input.paket_qty);
  if (canonical && alias && (canonical.package_item_id !== alias.package_item_id
    || canonical.package_qty !== alias.package_qty)) return invalid();
  const origin = canonical ?? alias;
  if (!origin) return {};
  // Origin is supported only on actual non-compound component rows. Reject
  // dropped/name-only rows rather than silently discarding an explicit claim.
  if (typeof input.item_id !== "string" || !UUID.test(input.item_id)
    || typeof input.nama_obat !== "string" || !input.nama_obat.trim()
    || input.jenis === "racikan" || input.compound_recipe_id != null) return invalid();
  return origin;
}
