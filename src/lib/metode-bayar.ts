// Daftar metode bayar kasir — satu sumber untuk layar bayar per hewan dan
// bayar rombongan, supaya keduanya tidak pernah menawarkan pilihan berbeda.
//
// Nama metode HARUS persis kosakata database (kas-akun METODE_BAYAR dan daftar di
// clinic_post_invoice): tombol "Kartu" dulu dikirim apa adanya lalu ditolak RPC dengan
// "INVOICE_INVALID: nilai invoice tidak konsisten" (4 Nov 2026). Kartu debit dan kredit
// dibukukan ke akun berbeda, jadi ditawarkan sebagai dua tombol. Kontrak dijaga oleh
// src/lib/__tests__/metode-bayar-kontrak.test.ts.

export const METODE_BAYAR = [
  { m: "Tunai", ic: "ti-cash", desc: "Bayar dengan uang tunai" },
  { m: "Transfer", ic: "ti-building-bank", desc: "Bayar melalui transfer bank" },
  { m: "Debit", ic: "ti-credit-card", desc: "Bayar dengan kartu debit" },
  { m: "Kredit", ic: "ti-credit-card", desc: "Bayar dengan kartu kredit" },
  { m: "QRIS", ic: "ti-qrcode", desc: "Bayar menggunakan QRIS" },
  { m: "E-Wallet", ic: "ti-wallet", desc: "Bayar menggunakan e-wallet" },
] as const;

export type MetodeBayar = (typeof METODE_BAYAR)[number]["m"];

/** True hanya untuk nama metode yang diterima database (perbandingan persis). */
export function metodeBayarSah(nilai: unknown): nilai is MetodeBayar {
  return typeof nilai === "string" && METODE_BAYAR.some(option => option.m === nilai);
}

/**
 * Metode dari draf peramban. Draf lama (mis. "Kartu") TIDAK boleh menghidupkan lagi metode yang ditolak
 * database, dan TIDAK boleh diam-diam diganti Tunai: tujuan uangnya berbeda (kas laci vs bank). Metode tak sah
 * dikembalikan kosong supaya kasir memilih ulang; jumlah bayar ikut direset agar satu klik tidak
 * membukukan penerimaan tunai penuh.
 */
export function pulihkanMetodeDraf(metode: unknown, bayar: unknown): {
  metode: MetodeBayar | ""; bayar: number; bayarManual: boolean; pesan: string | null;
} {
  if (metodeBayarSah(metode)) {
    const jumlah = Number(bayar);
    return { metode, bayar: Number.isFinite(jumlah) ? jumlah : 0, bayarManual: metode !== "Tunai" && jumlah > 0, pesan: null };
  }
  const lama = typeof metode === "string" && metode.trim() ? `"${metode.trim().slice(0, 30)}" ` : "";
  return {
    metode: "", bayar: 0, bayarManual: false,
    pesan: `Metode pembayaran ${lama}di draf ini sudah tidak dipakai. Pilih ulang metode bayar (Debit, Kredit, QRIS, Transfer, Tunai, atau E-Wallet); jumlah bayar dikosongkan.`,
  };
}

/** Pesan kasir bila metode bayar tidak dikenal; dipakai server action SEBELUM RPC uang apa pun. */
export function pesanMetodeBayarTidakSah(nilai: unknown): string {
  const dikirim = typeof nilai === "string" && nilai.trim() ? `"${nilai.trim().slice(0, 30)}" ` : "";
  return `Metode pembayaran ${dikirim}tidak dikenal. Pilih ulang salah satu: ${METODE_BAYAR.map(option => option.m).join(", ")}. Belum ada yang tersimpan.`;
}
