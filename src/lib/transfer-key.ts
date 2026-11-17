/** Kunci simpan pemindahan barang (Kirim/Terima). Fungsi database `post_stock_transfer_atomic` menolak kunci
 * yang sudah dimiliki dokumen LAIN dengan pesan persis di bawah. Galat yang DILEMPAR dari server action
 * disamarkan Next.js di produksi, jadi penolakan pasti ini harus DIKEMBALIKAN agar petugas bisa membacanya. */
export const TRANSFER_KEY_REUSED_MESSAGE = "Kunci pengiriman sudah dipakai";

export type TransferRejection = { ok: false; outcome: "rejected"; code: "stale_request_key"; message: string };

export const isStaleTransferKeyError = (message: unknown): boolean => message === TRANSFER_KEY_REUSED_MESSAGE;

export function staleTransferKeyRejection(receive: boolean): TransferRejection {
  const dokumen = receive ? "Penerimaan" : "Pemindahan";
  return {
    ok: false, outcome: "rejected", code: "stale_request_key",
    message: `Kunci simpan lama sudah dipakai dokumen lain. ${dokumen} ini BELUM tersimpan. Kunci sudah diganti otomatis; periksa isian lalu tekan Simpan sekali lagi.`,
  };
}

/** Peringatan bila percobaan sebelumnya dengan kunci yang sama belum jelas hasilnya (respons hilang): dokumen
 * pertama mungkin SUDAH tersimpan dan hanya isiannya yang diubah, jadi mengganti kunci diam-diam bisa menggandakan. */
export const TRANSFER_KEY_UNRESOLVED_MESSAGE = "Kunci simpan ini sudah tercatat di server dengan isian yang berbeda, padahal percobaan sebelumnya belum jelas hasilnya. Dokumen ini mungkin SUDAH tersimpan. Periksa daftar Pemindahan Barang dulu. Jika yakin belum ada, tekan Simpan sekali lagi.";
