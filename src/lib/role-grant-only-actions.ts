/**
 * Tindakan Akses Grup yang bersifat IZIN KHUSUS: bawaannya MATI untuk selain OWNER.
 *
 * Tindakan biasa di katalog bersifat "bawaan-boleh": peran tanpa kebijakan tersimpan (legacy) dianggap boleh melakukan semua
 * tindakan yang terhubung, dan kebijakan hanya MEMBATASI. Tindakan pembatalan kebalikannya: database hanya mengizinkan peran
 * selain OWNER bila kebijakan tersimpan secara eksplisit memuat tindakannya (purchase_cancel_allowed untuk pembelian). Karena itu
 * editor harus menampilkannya TIDAK tercentang untuk peran legacy; kalau tidak, Owner mengira ADMIN sudah boleh padahal database menolak.
 *
 * Daftar ini harus sama dengan baris katalog yang dipasang migrasi (dijaga tes sinkron per domain: penjualan/klinik/pembelian).
 * Tambahkan id baru di sini bila tindakan izin-khusus berikutnya dipasang; jangan menghapus yang sudah ada.
 */
export const GRANT_ONLY_ACTIONS: readonly string[] = [
  "penjualan.pos_penerimaan.batalkan",
  "penjualan.pos_penerimaan.tanggal_mundur",
  "klinik.batalkan_penerimaan",
  "pembelian.batalkan_penerimaan",
  "pembelian.batalkan_faktur",
  "pembelian.batalkan_pembayaran",
  "pembelian.batalkan_uang_muka",
];

export const isGrantOnlyAction = (id: string): boolean => GRANT_ONLY_ACTIONS.includes(id);
