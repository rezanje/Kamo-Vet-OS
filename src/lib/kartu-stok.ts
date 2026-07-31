// Kartu stok (migrasi 0074) — perhitungan saldo berjalan dipisah dari halaman
// supaya bisa dites: angka saldo inilah yang dipakai menelusuri selisih stok.

export type Mutasi = {
  tanggal: string;
  qty: number;            // + masuk, − keluar (satuan dasar)
  unit_cost: number;
  source: string;
  source_ref: string | null;
  gudang: string;
};

export type BarisKartu = Mutasi & { masuk: number; keluar: number; saldo: number };

// Label Indonesia untuk `source` yang ditulis lib/inventory.ts.
export const LABEL_SOURCE: Record<string, string> = {
  "saldo-awal": "Saldo Awal",
  purchase: "Penerimaan Pembelian",
  sale: "Faktur Penjualan",
  "sale-online": "Penjualan Online",
  klinik: "Pemakaian Klinik",
  racik: "Racikan Obat",
  transfer: "Pemindahan Barang",
  "transfer-in": "Pemindahan Masuk",
  "transfer-out": "Pemindahan Keluar",
  opname: "Stok Opname",
  "retur-jual": "Retur Penjualan",
  "retur-beli": "Retur Pembelian",
  manual: "Penyesuaian Manual",
};

export function labelSource(s: string): string {
  return LABEL_SOURCE[s] ?? s;
}

// Saldo berjalan. Urutan mutasi = urutan yang dikirim pemanggil (tanggal lalu
// created_at); saldo tidak boleh diurut ulang di sini atau angkanya jadi ngawur.
export function susunKartuStok(saldoAwal: number, moves: Mutasi[]): BarisKartu[] {
  let saldo = Number(saldoAwal) || 0;
  return moves.map((m) => {
    const qty = Number(m.qty) || 0;
    saldo += qty;
    return { ...m, masuk: qty > 0 ? qty : 0, keluar: qty < 0 ? -qty : 0, saldo };
  });
}
