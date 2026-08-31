export type JenisKomponen = "Persediaan" | "Jasa" | "Non-Persediaan" | "Grup";

export type KomponenGrupDraft = {
  component_item_id: string;
  qty: number;
  unit: string;
  factor: number;
};

export function validasiKomponenGrup(
  rows: KomponenGrupDraft[],
  jenis: Map<string, JenisKomponen>,
): string | null {
  if (rows.length === 0) return "Grup wajib punya minimal 1 komponen";

  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.component_item_id) return "Komponen wajib dipilih";
    if (!Number.isFinite(row.qty) || row.qty <= 0) return "Qty komponen harus lebih dari 0";
    if (!Number.isFinite(row.factor) || row.factor <= 0) return "Faktor satuan harus lebih dari 0";
    if (jenis.get(row.component_item_id) === "Grup") return "Komponen tidak boleh Grup";

    const key = `${row.component_item_id}:${row.unit.trim().toLowerCase()}`;
    if (seen.has(key)) return "Komponen dan satuan kembar tidak diperbolehkan";
    seen.add(key);
  }

  return null;
}

export type KebutuhanKomponen = {
  item_id: string;
  qty_dasar: number;
  item_type: JenisKomponen;
  source_sale_item: string;
};

export function agregasiKebutuhanGrup(rows: KebutuhanKomponen[]) {
  const total = new Map<string, number>();
  for (const row of rows) {
    if (row.item_type !== "Persediaan") continue;
    total.set(row.item_id, (total.get(row.item_id) ?? 0) + row.qty_dasar);
  }
  return [...total].map(([item_id, qty_dasar]) => ({ item_id, qty_dasar }));
}

export function stokEfektifGrup(
  rows: { item_id: string; qty_per_group: number; item_type: JenisKomponen }[],
  stok: Map<string, number>,
): number {
  const tracked = rows.filter((row) => row.item_type === "Persediaan");
  if (tracked.length === 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(...tracked.map((row) =>
    Math.floor((stok.get(row.item_id) ?? 0) / row.qty_per_group),
  )));
}
