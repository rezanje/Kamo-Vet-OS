// Kategori barang bertingkat (maks 2 tingkat: induk → anak), migrasi 0066.
// Batas 2 tingkat ditegakkan di sini + server action, bukan trigger DB —
// satu pintu tulis, jadi cukup dijaga di jalur itu.

export type KategoriRow = { id: string; name: string; parent_id: string | null; is_active: boolean };

const SEP = " › ";

const byName = (a: KategoriRow, b: KategoriRow) => a.name.localeCompare(b.name, "id");

// Anak yang induknya sudah hilang diperlakukan sebagai induk: lebih baik tampil
// salah tempat daripada hilang dari daftar tanpa jejak.
function indukEfektif(r: KategoriRow, byId: Map<string, KategoriRow>): string | null {
  return r.parent_id && byId.has(r.parent_id) ? r.parent_id : null;
}

export function buildTree(rows: KategoriRow[]): { induk: KategoriRow; anak: KategoriRow[] }[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const induk = rows.filter((r) => indukEfektif(r, byId) === null).sort(byName);
  return induk.map((p) => ({
    induk: p,
    anak: rows.filter((r) => indukEfektif(r, byId) === p.id).sort(byName),
  }));
}

export function labelPath(id: string, rows: KategoriRow[]): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const r = byId.get(id);
  if (!r) return "";
  const p = indukEfektif(r, byId);
  return p ? `${byId.get(p)!.name}${SEP}${r.name}` : r.name;
}

// Kembalikan pesan Indonesia kalau melanggar, null kalau boleh.
export function validateParent(id: string, parentId: string | null, rows: KategoriRow[]): string | null {
  if (!parentId) return null;
  if (parentId === id) return "Kategori tidak boleh jadi induk dirinya sendiri";

  const byId = new Map(rows.map((r) => [r.id, r]));
  const calon = byId.get(parentId);
  if (!calon) return "Kategori induk tidak ditemukan";

  if (indukEfektif(calon, byId) !== null) {
    return "Kategori hanya boleh dua tingkat — induk yang dipilih sudah jadi anak";
  }
  if (id && rows.some((r) => indukEfektif(r, byId) === id)) {
    return "Kategori ini sudah punya anak, jadi tidak boleh dipindah ke bawah kategori lain";
  }
  return null;
}

// Dropdown pemilihan kategori barang: nonaktif dibuang, anak dari induk yang
// nonaktif ikut dibuang (kalau tidak, barang bisa nyangkut di cabang mati).
export function flatOptions(rows: KategoriRow[]): { id: string; label: string }[] {
  const aktif = rows.filter((r) => r.is_active);
  const out: { id: string; label: string }[] = [];
  for (const { induk, anak } of buildTree(aktif)) {
    if (induk.parent_id && !aktif.some((r) => r.id === induk.parent_id)) continue;
    out.push({ id: induk.id, label: induk.name });
    for (const a of anak) out.push({ id: a.id, label: `${induk.name}${SEP}${a.name}` });
  }
  return out;
}
