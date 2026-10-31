// Stok di master tersimpan dalam satuan dasar; qty keranjang dikali faktor satuannya.
// Racikan tidak dihitung di sini: bahannya sudah dicek saat racikan disimpan.
// BMHP tindakan (mis. vial vaksin di Vaksinasi F3) ikut dihitung: stoknya dipotong saat pembayaran,
// jadi kekurangannya harus ditolak di sini, sama seperti obat.
// Tindakan persediaan ber-BMHP dikerjakan gaya pesanan: hasilnya diterima ke gudang dari
// biaya BMHP saat pembayaran, jadi stok barang tindakan itu sendiri tidak perlu ada.
import type { BarisKurangStok } from "./stok-kurang";

type Bmhp = { item_id: string; nama: string; qty: number; unit: string };

// Hasilnya baris terstruktur, bukan kalimat: popup "Stok tidak cukup" di rekam medis,
// catatan rawat inap, dan racikan memakai bentuk yang sama dengan proses stok lain.
export function kekuranganStok(
  rows: { item_id: string | null; nama_obat: string; qty: number; faktor: number; jenis: string; bmhp?: Bmhp[] }[],
  stok: Map<string, { stok: number | null; unit: string }>,
  faktorSatuan: (itemId: string, unit: string) => number = () => 1,
): BarisKurangStok[] {
  const butuh = new Map<string, { nama: string; qty: number }>();
  const tambah = (id: string, nama: string, qty: number) => {
    const prev = butuh.get(id);
    butuh.set(id, { nama: prev?.nama ?? nama, qty: (prev?.qty ?? 0) + qty });
  };
  for (const r of rows) {
    const bmhp = r.bmhp ?? [];
    if (r.jenis === "obat" && r.item_id && bmhp.length === 0) tambah(r.item_id, r.nama_obat, r.qty * (r.faktor || 1));
    if (r.jenis === "obat" || r.jenis === "jasa") {
      for (const b of bmhp) tambah(b.item_id, b.nama, b.qty * (faktorSatuan(b.item_id, b.unit) || 1));
    }
  }
  const kurang: BarisKurangStok[] = [];
  for (const [id, { nama, qty }] of butuh) {
    const s = stok.get(id);
    if (!s) continue;
    // Stok belum terbaca (null) bukan nol, tapi juga bukan "cukup": penjagaannya tetap menahan
    // simpan seperti sebelumnya, dengan jumlah tersedia "—" alih-alih angka 0 karangan.
    if (s.stok == null) kurang.push({ kunci: id, item_id: id, nama, butuh: qty, tersedia: null, satuan: s.unit });
    else if (qty > s.stok) kurang.push({ kunci: id, item_id: id, nama, butuh: qty, tersedia: s.stok, satuan: s.unit });
  }
  return kurang;
}
