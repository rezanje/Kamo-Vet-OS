// Logika murni laporan ala Accurate — dites di __tests__/laporan.test.ts

// ── Ringkasan Persediaan per Gudang (matrix) ─────────────────────────────────
export type StokBaris = {
  item_id: string; code: string; name: string; unit: string;
  wh_code: string; qty: number;
};

export type MatrixRow = {
  item_id: string; code: string; name: string; unit: string;
  per: Record<string, number>; total: number;
};

export function pivotStokPerGudang(rows: StokBaris[]): { gudang: string[]; items: MatrixRow[] } {
  const gudangSet = new Set<string>();
  const map = new Map<string, MatrixRow>();
  for (const r of rows) {
    gudangSet.add(r.wh_code);
    const cur = map.get(r.item_id) ?? {
      item_id: r.item_id, code: r.code, name: r.name, unit: r.unit, per: {}, total: 0,
    };
    cur.per[r.wh_code] = (cur.per[r.wh_code] ?? 0) + Number(r.qty);
    cur.total += Number(r.qty);
    map.set(r.item_id, cur);
  }
  return {
    gudang: [...gudangSet].sort(),
    items: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ── Penjualan per Barang ─────────────────────────────────────────────────────
export type PenjualanBarang = { nama: string; qty: number; omzet: number };

export function aggPenjualanPerBarang(items: { nama: string; qty: number; harga: number }[]): PenjualanBarang[] {
  const map = new Map<string, PenjualanBarang>();
  for (const it of items) {
    const cur = map.get(it.nama) ?? { nama: it.nama, qty: 0, omzet: 0 };
    cur.qty += Number(it.qty) || 0;
    cur.omzet += (Number(it.qty) || 0) * (Number(it.harga) || 0);
    map.set(it.nama, cur);
  }
  return [...map.values()].sort((a, b) => b.omzet - a.omzet);
}

// ── Preset unit Laba/Rugi (Klinik/Petshop) ───────────────────────────────────
// Nilai param cabang "unit:KLINIK" / "unit:PETSHOP" → daftar tipe cabang.
export function resolveUnitTypes(cabang: string | undefined): string[] | null {
  if (!cabang?.startsWith("unit:")) return null;
  const unit = cabang.slice(5);
  if (unit === "KLINIK") return ["KLINIK", "BOTH"];
  if (unit === "PETSHOP") return ["PETSHOP", "BOTH"];
  return null;
}
