// Stok di master tersimpan dalam satuan dasar; qty keranjang dikali faktor satuannya.
// Racikan tidak dihitung di sini: bahannya sudah dicek saat racikan disimpan.
// BMHP tindakan (mis. vial vaksin di Vaksinasi F3) ikut dihitung: stoknya dipotong saat pembayaran,
// jadi kekurangannya harus ditolak di sini, sama seperti obat.
type Bmhp = { item_id: string; nama: string; qty: number; unit: string };
export function kekuranganStok(
  rows: { item_id: string | null; nama_obat: string; qty: number; faktor: number; jenis: string; bmhp?: Bmhp[] }[],
  stok: Map<string, { stok: number; unit: string }>,
  faktorSatuan: (itemId: string, unit: string) => number = () => 1,
): string[] {
  const butuh = new Map<string, { nama: string; qty: number }>();
  const tambah = (id: string, nama: string, qty: number) => {
    const prev = butuh.get(id);
    butuh.set(id, { nama: prev?.nama ?? nama, qty: (prev?.qty ?? 0) + qty });
  };
  for (const r of rows) {
    if (r.jenis === "obat" && r.item_id) tambah(r.item_id, r.nama_obat, r.qty * (r.faktor || 1));
    if (r.jenis === "jasa") for (const b of r.bmhp ?? []) tambah(b.item_id, b.nama, b.qty * (faktorSatuan(b.item_id, b.unit) || 1));
  }
  const kurang: string[] = [];
  for (const [id, { nama, qty }] of butuh) {
    const s = stok.get(id);
    if (s && qty > s.stok) kurang.push(`${nama}: butuh ${qty} ${s.unit}, stok ${s.stok} ${s.unit}`);
  }
  return kurang;
}
