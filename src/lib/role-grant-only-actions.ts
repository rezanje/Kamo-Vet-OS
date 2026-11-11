/**
 * Tindakan Akses Grup yang bersifat IZIN KHUSUS: bawaannya MATI untuk selain OWNER.
 *
 * Tindakan biasa di katalog bersifat "bawaan-boleh": peran tanpa kebijakan tersimpan (legacy) dianggap boleh melakukan semua
 * tindakan yang terhubung, dan kebijakan hanya MEMBATASI. Tindakan pembatalan pembelian kebalikannya: database hanya mengizinkan
 * peran selain OWNER bila kebijakan tersimpan secara eksplisit memuat tindakannya (purchase_cancel_allowed). Karena itu editor harus
 * menampilkannya TIDAK tercentang untuk peran legacy; kalau tidak, Owner mengira ADMIN sudah boleh padahal database menolak.
 *
 * Daftar ini harus sama dengan baris katalog yang dipasang migrasi 20261112500000_batal_pembelian_owner_penuh (dijaga tes sinkron).
 * Tambahkan id baru di sini bila tindakan izin-khusus berikutnya dipasang; jangan menghapus yang sudah ada.
 */
export const GRANT_ONLY_ACTIONS: readonly string[] = [
  "pembelian.batalkan_penerimaan",
  "pembelian.batalkan_faktur",
  "pembelian.batalkan_pembayaran",
  "pembelian.batalkan_uang_muka",
];

export const isGrantOnlyAction = (id: string): boolean => GRANT_ONLY_ACTIONS.includes(id);
