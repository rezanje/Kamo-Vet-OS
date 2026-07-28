// Satuan master global (tabel units, migrasi 0066). Dipisah dari satuan.ts yang
// mengurus KONVERSI per barang; file ini cuma soal penulisan nama satuan.
//
// Kenapa dinormalkan: "pcs" / "Pcs" / "PCS" pernah masuk sebagai tiga satuan
// berbeda, bikin laporan stok pecah dan migrasi dari Accurate kotor.

const MAX = 20; // batas kolom units.nama

export function normalizeUnit(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, MAX);
}

export function dedupeUnits(raws: string[]): string[] {
  const set = new Set<string>();
  for (const r of raws) {
    const n = normalizeUnit(r);
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "id"));
}
