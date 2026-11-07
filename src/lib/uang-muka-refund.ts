/** "Kembalikan saldo uang muka" (UMK klinik) lewat transfer bank: pesan galat dalam bahasa Indonesia sederhana + pembantu tampilan.
 *  Kode di awal pesan RPC (mis. "AMOUNT_EXCEEDS: ...") dipetakan ke kalimat yang dimengerti Owner/Finance. Pesan mentah tidak pernah ditampilkan. */
const PESAN: Record<string, string> = {
  ACCESS_DENIED: "Hanya Owner atau Finance (cabang ini) yang boleh mengembalikan saldo uang muka.",
  AMOUNT_INVALID: "Jumlah pengembalian harus lebih dari 0 dan paling banyak 2 angka desimal.",
  AMOUNT_EXCEEDS: "Jumlah melebihi saldo uang muka yang belum terpakai.",
  REASON_REQUIRED: "Alasan wajib diisi (minimal 5 huruf, maksimal 500).",
  DESTINATION_INVALID: "Lengkapi bank, nomor rekening (huruf/angka/spasi/strip) dan nama pemilik rekening tujuan.",
  KEY_REQUIRED: "Identitas permintaan belum siap. Muat ulang halaman.",
  IDEMPOTENCY_CONFLICT: "Permintaan dengan kunci yang sama sudah dipakai untuk pengembalian lain. Muat ulang halaman.",
  ADVANCE_INVALID: "Uang muka ini sudah dibatalkan; tidak bisa dikembalikan.",
  CLAIM_REQUIRED: "Tekan \"Ambil proses\" lebih dulu. Hanya petugas yang mengambil proses yang bisa mencatat transfer selesai.",
  CLAIM_TAKEN: "Pengembalian ini sedang ditangani petugas lain. Jangan transfer ulang; hubungi petugas itu atau Owner.",
  CLAIM_STATE: "Pengembalian ini sudah selesai atau dibatalkan, tidak bisa diambil proses.",
  REFUND_NOT_FOUND: "Permintaan pengembalian tidak ditemukan.",
  REFUND_DONE: "Pengembalian ini sudah ditransfer dan dijurnal; tidak bisa dibatalkan.",
  REFUND_CANCELLED: "Permintaan pengembalian ini sudah dibatalkan.",
  ALREADY_DONE: "Transfer ini sudah dicatat dengan rincian berbeda. Tidak dicatat dua kali; periksa riwayatnya.",
  REFERENCE_REQUIRED: "Isi referensi transfer bank (nomor bukti transfer).",
  DATE_INVALID: "Tanggal transfer tidak boleh di masa depan atau lebih awal dari tanggal pengajuan.",
  ACCOUNT_INVALID: "Pilih rekening bank sumber yang aktif dan berlaku untuk cabang ini.",
  PERIOD_LOCKED: "Periode akuntansi sudah ditutup; transfer tidak bisa dijurnal pada tanggal itu.",
  CANCEL_CONFIRM_REQUIRED: "Konfirmasi dulu bahwa pengembalian ini belum ditransfer.",
  ADVANCE_REFUNDED: "Uang muka ini sudah atau sedang dikembalikan, jadi kwitansinya tidak bisa dibatalkan. Kembalikan sisanya lewat \"Kembalikan saldo uang muka\".",
  ADVANCE_FENCE: "Data uang muka tidak cocok dengan pengembaliannya. Hubungi Reza; tidak ada yang diubah.",
};

export function pesanRefundUangMuka(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim();
  const code = /^([A-Z_]{4,40}):/.exec(text)?.[1];
  if (code && PESAN[code]) {
    const detail = text.slice(code.length + 1).trim();
    if (code === "AMOUNT_EXCEEDS") { const saldo = /\(([\d.]+)\)\s*$/.exec(detail)?.[1]; return saldo ? `${PESAN[code]} Saldo tersisa Rp ${Number(saldo).toLocaleString("id-ID", { maximumFractionDigits: 2 })}.` : PESAN[code]; }
    if (code === "PERIOD_LOCKED") { const tgl = /(\d{4}-\d{2}-\d{2})/.exec(detail)?.[1]; return tgl ? `${PESAN[code]} (ditutup sampai ${tgl})` : PESAN[code]; }
    return PESAN[code];
  }
  if (/lock timeout|55P03|40P01|deadlock/i.test(text)) return "Uang muka atau tagihan sedang dipakai kasir lain. Tunggu sebentar lalu coba lagi.";
  if (/permission denied|42501/i.test(text)) return PESAN.ACCESS_DENIED;
  return "Hasil belum terkonfirmasi. Periksa status pengembalian sebelum mencoba lagi. Jangan transfer ulang; tidak ada yang diulang otomatis.";
}

/** Saldo uang muka yang belum terpakai (pengajuan yang menunggu sudah dikurangkan oleh database dari amount). */
export function hitungSaldoUangMuka(a: { amount: number; applied: number; status: string }): number {
  const amount = Number(a.amount), applied = Number(a.applied);
  if (a.status !== "aktif" || !Number.isFinite(amount) || !Number.isFinite(applied)) return 0;
  return Math.max(0, Math.round((amount - applied) * 100) / 100);
}

const LABEL_STATUS: Record<string, string> = {
  pending: "Menunggu Finance",
  diproses: "Sedang diproses Finance (belum ditransfer di sistem)",
  selesai: "Transfer selesai & dijurnal",
  batal: "Dibatalkan (batal)",
};
export const labelStatusRefund = (status: string) => LABEL_STATUS[status] ?? status;

export type RefundUangMuka = {
  id: string; no_refund: string; amount: number; status: string; requested_at: string; bank_reference?: string | null; tanggal?: string | null;
  destination?: { bank: string; account: string; name: string } | null; cancel_reason?: string | null;
};
