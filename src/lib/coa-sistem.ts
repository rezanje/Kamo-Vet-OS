// Aturan main Bagan Akun (COA) — logika murni, dites di __tests__/coa-sistem.test.ts.
//
// Akun bukan master data biasa. postJournal mencari akun lewat KODE-nya
// (lib/posting.ts) dan kalau kodenya tidak ketemu ia berhenti DIAM-DIAM: transaksi
// tetap tersimpan, jurnalnya tidak pernah ada. Jadi satu akun yang kodenya diubah
// atau dinonaktifkan sembarangan bisa mematikan pencatatan satu jalur uang tanpa
// pesan error sama sekali. Semua larangan di file ini lahir dari situ.

export const TIPE_AKUN = ["ASET", "LIABILITAS", "EKUITAS", "PENDAPATAN", "BEBAN"] as const;
export type TipeAkun = (typeof TIPE_AKUN)[number];

/** Digit pertama kode menentukan kelompoknya — semua laporan mengelompokkan lewat `type`,
 *  jadi kode dan tipe yang tidak sejalan bikin akun muncul di tempat yang salah. */
export const DIGIT_TIPE: Record<string, TipeAkun> = {
  "1": "ASET", "2": "LIABILITAS", "3": "EKUITAS", "4": "PENDAPATAN", "5": "BEBAN",
};

/** Sisi saldo yang wajar untuk tiap kelompok. */
export const SISI_WAJAR: Record<TipeAkun, "D" | "K"> = {
  ASET: "D", LIABILITAS: "K", EKUITAS: "K", PENDAPATAN: "K", BEBAN: "D",
};

/**
 * Akun kontra (saldo normalnya berlawanan dengan kelompoknya) hanya masuk akal di
 * neraca — contohnya 1509 Akumulasi Penyusutan yang bertipe ASET tapi bersaldo
 * kredit, dan sudah ditangani `nilaiSeksi` di lib/ledger.
 *
 * Untuk PENDAPATAN & BEBAN tidak boleh: Laba Rugi, dashboard, dan jurnal penutup
 * membaca saldo mentah tanpa lewat `nilaiSeksi`, jadi akun kontra di dua kelompok
 * itu akan menggandakan angkanya saat tutup buku.
 */
export const BOLEH_KONTRA: TipeAkun[] = ["ASET", "LIABILITAS", "EKUITAS"];

/** Jatah kode yang dialokasikan otomatis saat menambah rekening kas/bank
 *  (lib/transfer-kas → kodeAkunBerikutnya). Form manual tidak boleh menyerobot. */
export const KODE_REKENING_MIN = 1103;
export const KODE_REKENING_MAX = 1199;

/**
 * Kode yang dipakai KERAS di dalam kode program. Menonaktifkan atau menimpanya
 * berarti mematikan jalur uang yang memakainya — dan matinya tanpa suara.
 *
 * Satu sumber kebenaran; jangan disalin ke tempat lain.
 */
export const KODE_SISTEM: Record<string, string> = {
  "1101": "kas bawaan & selisih kas tutup shift",
  "1102": "bank bawaan untuk semua pembayaran non-tunai",
  "1105": "PPN Masukan (faktur pembelian & rekap PPN)",
  "1201": "piutang usaha klinik & faktur penjualan",
  "1202": "piutang marketplace",
  "1203": "piutang karyawan (kasbon)",
  "1301": "persediaan — dipakai hampir semua jalur stok",
  "1303": "uang muka pembelian",
  "1501": "aset tetap",
  "1509": "akumulasi penyusutan",
  "2101": "hutang usaha",
  "2102": "hutang belum difakturkan (penerimaan barang)",
  "2103": "uang muka penjualan",
  "2201": "PPN Keluaran",
  "3101": "modal pemilik (saldo awal & saldo awal rekening)",
  "3201": "laba ditahan (target jurnal penutup)",
  "4101": "pendapatan penjualan produk",
  "4201": "pendapatan jasa klinik",
  "4301": "pendapatan bunga bank (rekonsiliasi)",
  "4302": "laba pelepasan aset tetap",
  "4303": "pendapatan lain-lain (kelebihan kas tutup shift)",
  "5101": "beban pokok penjualan — juga penanda HPP di Laba Rugi & dashboard",
  "5201": "beban gaji",
  "5301": "beban listrik & air (kategori pengeluaran)",
  "5302": "beban perlengkapan (kategori pengeluaran)",
  "5303": "beban transportasi (kategori pengeluaran)",
  "5304": "beban perawatan aset (kategori pengeluaran)",
  "5305": "beban komisi marketplace",
  "5401": "beban operasional lain-lain (kategori pengeluaran)",
  "5501": "beban administrasi bank (transfer & rekonsiliasi)",
  "5601": "beban penyusutan",
  "5602": "rugi pelepasan aset tetap",
  "5901": "selisih kas tutup shift",
  "5902": "selisih persediaan (opname & retur barang rusak)",
};

export const akunSistem = (code: string) => code in KODE_SISTEM;

export type DraftAkun = {
  code: string;
  name: string;
  type: string;
  normal_balance: string;
};

/** Validasi akun BARU. Mengembalikan pesan error, atau null kalau lolos. */
export function validasiAkunBaru(d: DraftAkun): string | null {
  const code = d.code.trim();
  if (!/^\d{4}$/.test(code)) return "Kode akun harus 4 angka, contoh 5403.";

  const tipe = d.type as TipeAkun;
  if (!TIPE_AKUN.includes(tipe)) return "Kelompok akun tidak dikenal.";

  const harusnya = DIGIT_TIPE[code[0]];
  if (harusnya !== tipe) {
    return `Kode ${code} berawalan ${code[0]}, yang berarti kelompok ${harusnya}. Ganti kodenya jadi ${Object.keys(DIGIT_TIPE).find((k) => DIGIT_TIPE[k] === tipe)}xxx, atau ganti kelompoknya.`;
  }

  const angka = Number(code);
  if (angka >= KODE_REKENING_MIN && angka <= KODE_REKENING_MAX) {
    return `Kode ${KODE_REKENING_MIN}–${KODE_REKENING_MAX} adalah jatah rekening kas/bank yang dibuat otomatis dari menu Kas & Bank → Rekening. Pakai kode lain.`;
  }

  if (akunSistem(code)) {
    return `Kode ${code} sudah dipakai sistem untuk ${KODE_SISTEM[code]}. Pilih kode lain.`;
  }

  if (!d.name.trim()) return "Nama akun wajib diisi.";
  if (d.name.trim().length > 80) return "Nama akun maksimal 80 huruf.";

  return validasiSisiSaldo(tipe, d.normal_balance);
}

/** Saldo normal boleh berlawanan HANYA untuk kelompok neraca (akun kontra). */
export function validasiSisiSaldo(tipe: TipeAkun, normal: string): string | null {
  if (normal !== "D" && normal !== "K") return "Saldo normal harus Debit atau Kredit.";
  const wajar = SISI_WAJAR[tipe];
  if (normal === wajar) return null;
  if (!BOLEH_KONTRA.includes(tipe)) {
    return `Akun ${tipe} harus bersaldo normal ${wajar === "D" ? "Debit" : "Kredit"}. Saldo terbalik di kelompok ini membuat angkanya berlipat saat tutup buku.`;
  }
  return null; // akun kontra neraca — sah, mis. 1509 Akumulasi Penyusutan
}

/**
 * Perubahan akun yang sudah ada. Kode tidak pernah bisa diubah (semua jalur uang
 * mencarinya lewat kode), dan tipe/saldo normal terkunci begitu akun punya jurnal —
 * membaliknya membalik tanda SELURUH riwayat, bukan cuma transaksi baru.
 */
export function validasiUbahAkun(
  d: DraftAkun,
  lama: { code: string; type: string; normal_balance: string },
  punyaJurnal: boolean,
): string | null {
  if (d.code.trim() !== lama.code) {
    return "Kode akun tidak bisa diubah. Nonaktifkan akun ini lalu buat akun baru kalau kodenya memang salah.";
  }
  if (!d.name.trim()) return "Nama akun wajib diisi.";
  if (d.name.trim().length > 80) return "Nama akun maksimal 80 huruf.";

  const tipe = d.type as TipeAkun;
  if (!TIPE_AKUN.includes(tipe)) return "Kelompok akun tidak dikenal.";

  const berubah = d.type !== lama.type || d.normal_balance !== lama.normal_balance;
  if (berubah && punyaJurnal) {
    return "Akun ini sudah punya jurnal — kelompok & saldo normalnya tidak bisa diubah lagi, karena itu akan mengubah seluruh riwayat laporan.";
  }
  if (berubah && DIGIT_TIPE[lama.code[0]] !== tipe) {
    return `Kode ${lama.code} berawalan ${lama.code[0]} yang berarti kelompok ${DIGIT_TIPE[lama.code[0]]}. Kelompoknya tidak boleh berbeda dari kodenya.`;
  }
  return validasiSisiSaldo(tipe, d.normal_balance);
}

export type PemakaiAkun = {
  jurnal: number;
  rekeningKas: boolean;
  kategoriAset: boolean;
  jurnalBerulang: boolean;
};

/** Alasan sebuah akun tidak boleh dinonaktifkan, atau null kalau boleh. */
export function alasanTakBolehNonaktif(code: string, p: PemakaiAkun): string | null {
  if (akunSistem(code)) {
    return `Akun ${code} dipakai sistem untuk ${KODE_SISTEM[code]} — menonaktifkannya membuat pencatatan itu berhenti tanpa peringatan.`;
  }
  if (p.rekeningKas) return `Akun ${code} adalah akun sebuah rekening kas/bank. Nonaktifkan rekeningnya dari menu Kas & Bank.`;
  if (p.kategoriAset) return `Akun ${code} dipakai kategori aset untuk jurnal penyusutan.`;
  if (p.jurnalBerulang) return `Akun ${code} dipakai jurnal berulang yang masih aktif.`;
  return null;
}
