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
  // Impor saldo awal gaya Accurate menulis sumber ini — sebelum dinamai, kartu
  // stok menampilkan slug mentahnya, padahal inilah mutasi terbanyak di Production.
  "saldo-awal-accurate": "Saldo Awal (Impor Accurate)",
  purchase: "Penerimaan Pembelian",
  "purchase-receipt-void": "Pembatalan Penerimaan Barang",
  "purchase-invoice-void": "Pembatalan Faktur Pembelian",
  sale: "Faktur Penjualan",
  "sale-group": "Faktur Penjualan (Paket)",
  "sale-void": "Pembatalan Faktur Penjualan",
  "sale-online": "Penjualan Online",
  klinik: "Pemakaian Klinik",
  "klinik-bmhp": "BMHP Tindakan",
  "pesanan-selesai": "Penyelesaian Pesanan",
  racik: "Racikan Obat",
  "racik-koreksi": "Koreksi Racikan",
  "racik-kembali": "Pengembalian Racikan",
  transfer: "Pemindahan Barang",
  "transfer-in": "Pemindahan Masuk",
  "transfer-out": "Pemindahan Keluar",
  opname: "Stok Opname",
  "opname-selisih": "Selisih Stok Opname",
  penyesuaian: "Penyesuaian Persediaan",
  produksi: "Produksi Own Brand",
  "stock-correction": "Koreksi Stok",
  "stock-correct-reverse": "Pembatalan Koreksi Stok",
  "retur-jual": "Retur Penjualan",
  "retur-jual-group": "Retur Penjualan (Paket)",
  "return-record-void": "Pembatalan Retur",
  "retur-klinik": "Refund Klinik",
  "retur-beli": "Retur Pembelian",
  "faktur-langsung": "Faktur Pembelian Langsung",
  "kirim-permintaan": "Pengiriman Permintaan Barang",
  "terima-permintaan": "Penerimaan Permintaan Barang",
  "retur-permintaan": "Sisa Kiriman Kembali ke Gudang",
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
