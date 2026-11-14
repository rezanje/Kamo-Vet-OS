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
  "klinik.batalkan_penerimaan_tanggal",
  "pembelian.batalkan_penerimaan",
  "pembelian.batalkan_faktur",
  "pembelian.batalkan_pembayaran",
  "pembelian.batalkan_uang_muka",
  "pembelian.tanggal_mundur",
  "kasir.diskon_manual",
  // Owner jual di bawah modal (obral, Persediaan, petshop), 14 Nov 2026: bawaan MATI untuk semua peran selain OWNER (migrasi 20261118100000_owner_jual_bawah_modal.sql).
  "kasir.jual_bawah_modal",
  // A5 (meeting 12 Nov 2026): koreksi visit rawat inap (migrasi 20261113031357_a5_koreksi_visit_rawat_inap.sql).
  "klinik.koreksi_visit",
  // D1 (meeting 12 Nov 2026): sesuaikan poin pelanggan manual (migrasi 20261114085215_d1_poin_manual.sql).
  "crm.poin_manual",
  // B2 (meeting 12 Nov 2026): batalkan tagihan klinik belum lunas/DP (migrasi 20261118620000_b2_batalkan_tagihan_klinik.sql).
  "klinik.batalkan_tagihan",
];

export const isGrantOnlyAction = (id: string): boolean => GRANT_ONLY_ACTIONS.includes(id);

/**
 * Pengecualian bawaan per peran: izin khusus yang untuk peran TANPA kebijakan tersimpan (legacy) justru bawaannya HIDUP.
 * Harus sama dengan fungsi database pemeriksanya (mis. manual_discount_allowed: legacy hanya ADMIN).
 */
export const GRANT_ONLY_LEGACY_ROLES: Readonly<Record<string, readonly string[]>> = {
  "kasir.diskon_manual": ["ADMIN"],
};

/** Peran legacy dianggap punya tindakan ini? Tindakan biasa: ya. Izin khusus: hanya bila peran ada di daftar pengecualian. */
export const legacyRoleHasAction = (id: string, role: string): boolean =>
  !isGrantOnlyAction(id) || (GRANT_ONLY_LEGACY_ROLES[id] ?? []).includes(role);
