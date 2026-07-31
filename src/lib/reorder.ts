// Barang stok minimum → usulan pesan. Perhitungannya dipisah dari halaman supaya
// bisa dites: angka inilah yang jadi qty di draft PO, jadi salah sedikit = salah beli.

export type BarangReorder = {
  itemId: string;
  kode: string;
  nama: string;
  satuan: string;        // satuan dasar (stok selalu dihitung di sini)
  stok: number;
  minStock: number;
  minBuy: number;        // minimum pesan dari pemasok, dalam satuan beli
  buyUnit: string | null;
  faktorBeli: number;    // isi 1 satuan beli dalam satuan dasar
  hargaBeli: number;     // harga per satuan beli
  supplierId: string | null;
  supplierNama: string;
};

export type Usulan = BarangReorder & {
  kurang: number;        // kekurangan dalam satuan dasar
  qtyPesan: number;      // qty dalam SATUAN BELI, sudah dibulatkan ke atas & kena minimum
  nilai: number;
};

// Kekurangan dibulatkan KE ATAS ke satuan beli: tidak mungkin memesan 0,4 dus.
// Minimum beli pemasok jadi lantai, bukan pengganti — kalau kurangnya lebih besar
// dari minimum, yang dipakai tetap kekurangan sebenarnya.
export function hitungUsulan(b: BarangReorder): Usulan {
  const kurang = Math.max(0, Number(b.minStock) - Number(b.stok));
  const faktor = Number(b.faktorBeli) > 0 ? Number(b.faktorBeli) : 1;
  const perluSatuanBeli = Math.ceil(kurang / faktor);
  const qtyPesan = Math.max(perluSatuanBeli, Number(b.minBuy) || 0);
  return { ...b, kurang, qtyPesan, nilai: qtyPesan * (Number(b.hargaBeli) || 0) };
}

// Barang menipis = stok di bawah batas minimum. Batas 0 berarti tidak diawasi:
// tanpa aturan ini setiap barang yang kebetulan habis akan ikut mengusulkan PO.
export function perluDipesan(b: { stok: number; minStock: number }): boolean {
  return Number(b.minStock) > 0 && Number(b.stok) < Number(b.minStock);
}

// Kelompokkan per pemasok — satu PO per pemasok, itulah gunanya pemasok utama.
export function kelompokPemasok(rows: Usulan[]): { supplierId: string | null; supplierNama: string; rows: Usulan[]; nilai: number }[] {
  const map = new Map<string, { supplierId: string | null; supplierNama: string; rows: Usulan[]; nilai: number }>();
  for (const r of rows) {
    const k = r.supplierId ?? "";
    const g = map.get(k) ?? { supplierId: r.supplierId, supplierNama: r.supplierNama, rows: [], nilai: 0 };
    g.rows.push(r);
    g.nilai += r.nilai;
    map.set(k, g);
  }
  // Barang tanpa pemasok ditaruh paling akhir: butuh keputusan manusia dulu.
  return [...map.values()].sort((a, b) =>
    a.supplierId === b.supplierId ? 0 : !a.supplierId ? 1 : !b.supplierId ? -1 : a.supplierNama.localeCompare(b.supplierNama),
  );
}
