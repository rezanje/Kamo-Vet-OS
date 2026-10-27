/** K02: BMHP (bahan habis pakai) dipakai pada baris tindakan klinik.
 * Only item IDs, quantities and units cross the write boundary; the database
 * supplies names, base units and costs at save/posting time. */
export type BmhpRow = { item_id: string; nama: string; qty: number; unit: string };
export type BmhpInput = { item_id: string; qty: number; unit: string };

export const BMHP_MAX_COMPONENTS = 50;

export function bmhpInput(value: unknown): BmhpInput[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > BMHP_MAX_COMPONENTS) throw Error("Daftar BMHP tidak valid");
  const seen = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("Daftar BMHP tidak valid");
    const row = raw as Record<string, unknown>;
    const id = typeof row.item_id === "string" ? row.item_id.trim() : "";
    const qty = Number(row.qty);
    const unit = typeof row.unit === "string" ? row.unit.trim() : "";
    if (!id || id.length > 80 || !Number.isFinite(qty) || qty <= 0 || qty > 100000 || !unit || unit.length > 20)
      throw Error("Bahan atau jumlah BMHP tidak valid");
    if (seen.has(id)) throw Error("Bahan BMHP yang sama dipilih lebih dari sekali");
    seen.add(id);
    return { item_id: id, qty, unit };
  });
}

// Vaccination services are coded "JV-<vial code>" (docs/rollback/2026-10-27-k02-vaksinasi-bmhp.sql);
// the vial is their default BMHP, and a vial picked from the medicine list opens its vaccination.
type Coded = { id: string; code?: string | null; name: string; unit: string };
const VACCINATION = "JV-";
export const vaccinationOf = <T extends Coded>(vial: Coded, services: T[]) =>
  vial.code ? services.find(service => service.code === VACCINATION + vial.code) : undefined;
export function vaccinationBmhp(service: Coded, items: Coded[]): BmhpRow[] {
  const code = service.code?.startsWith(VACCINATION) ? service.code.slice(VACCINATION.length) : "";
  const vial = code ? items.find(item => item.code === code) : undefined;
  return vial ? [{ item_id: vial.id, nama: vial.name, qty: 1, unit: vial.unit }] : [];
}
