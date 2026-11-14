// E2 (meeting 12 Nov 2026): pesan database penjualan online untuk paket (barang Grup).
// Database memberi kode di depan pesan (E2_GRUP_SATUAN / _KOSONG / _RUSAK / _SUMBER) supaya bisa diuji;
// pengguna cukup melihat kalimatnya.
export function pesanDbOnline(raw: string): string {
  return raw.replace(/^E2_GRUP_[A-Z]+:\s*/, "");
}
