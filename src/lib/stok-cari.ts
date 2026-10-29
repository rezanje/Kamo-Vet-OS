/** Pencarian barang di halaman Stok per Gudang. */

/** Pola ilike PostgREST yang aman untuk dipakai di dalam `.or(...)`.
 * Karakter yang punya arti di sintaks filter (koma, kurung, titik dua, kutip,
 * backslash) dan wildcard (%, _, *) dibuang; spasi berurutan jadi wildcard,
 * sehingga "bolt 1kg" cocok dengan "BOLT IKAN 1KG". */
export function polaCariStok(q: string | null | undefined): string | null {
  const bersih = (q ?? "").replace(/[,()*%_:"'\\]/g, " ").trim().replace(/\s+/g, "*");
  return bersih ? `*${bersih}*` : null;
}

/** Pencocokan di sisi server untuk tampilan matrix (semua gudang). */
export function cocokCariStok(q: string, code: string | null | undefined, name: string | null | undefined): boolean {
  const kata = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (kata.length === 0) return true;
  const kodeL = (code ?? "").toLowerCase();
  const namaL = (name ?? "").toLowerCase();
  if (kata.length === 1 && kodeL.includes(kata[0])) return true;
  let pos = 0;
  for (const k of kata) {
    const i = namaL.indexOf(k, pos);
    if (i < 0) return false;
    pos = i + k.length;
  }
  return true;
}
