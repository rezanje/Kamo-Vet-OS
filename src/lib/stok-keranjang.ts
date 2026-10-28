// Stok di master tersimpan dalam satuan dasar; qty keranjang dikali faktor satuannya.
// Racikan tidak dihitung di sini: bahannya sudah dicek saat racikan disimpan.
export function kekuranganStok(
  rows: { item_id: string | null; nama_obat: string; qty: number; faktor: number; jenis: string }[],
  stok: Map<string, { stok: number; unit: string }>,
): string[] {
  const butuh = new Map<string, { nama: string; qty: number }>();
  for (const r of rows) {
    if (r.jenis !== "obat" || !r.item_id) continue;
    const prev = butuh.get(r.item_id);
    butuh.set(r.item_id, { nama: r.nama_obat, qty: (prev?.qty ?? 0) + r.qty * (r.faktor || 1) });
  }
  const kurang: string[] = [];
  for (const [id, { nama, qty }] of butuh) {
    const s = stok.get(id);
    if (s && qty > s.stok) kurang.push(`${nama}: butuh ${qty} ${s.unit}, stok ${s.stok} ${s.unit}`);
  }
  return kurang;
}
