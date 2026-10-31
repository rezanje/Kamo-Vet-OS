// Aturan main Bagan Akun (COA) — logika murni, dites di __tests__/coa-sistem.test.ts.
//
// Akun bukan master data biasa. postJournal mencari akun lewat KODE-nya
// (lib/posting.ts) dan kalau kodenya tidak ketemu ia berhenti DIAM-DIAM: transaksi
// tetap tersimpan, jurnalnya tidak pernah ada. Jadi satu akun yang kodenya diubah
// atau dinonaktifkan sembarangan bisa mematikan pencatatan satu jalur uang tanpa
// pesan error sama sekali. Semua larangan di file ini lahir dari situ.

export const TIPE_AKUN = ["ASET", "LIABILITAS", "EKUITAS", "PENDAPATAN", "BEBAN"] as const;
export type TipeAkun = (typeof TIPE_AKUN)[number];

/**
 * Kelompok akun dari kodenya — semua laporan mengelompokkan lewat `type`, jadi kode
 * dan tipe yang tidak sejalan bikin akun muncul di tempat yang salah.
 *
 * Bagan akun baru (31 Okt 2026, 6 digit): 1 kas/bank & aset lancar, 2 aset tetap,
 * 3 liabilitas, 4 ekuitas, 5 pendapatan, 6 HPP, 7 beban, 80/81 pendapatan di luar
 * operasional, 82 beban di luar operasional. Kode lama 4–5 digit yang masih tersisa
 * tetap dibaca dengan pola lama (1 aset … 5 beban). Sama dengan
 * public.coa_type_for_code() di database.
 */
export function tipeDariKode(code: string): TipeAkun | null {
  const c = String(code ?? "").trim();
  if (/^\d{6}$/.test(c)) {
    if (/^[12]/.test(c)) return "ASET";
    if (c[0] === "3") return "LIABILITAS";
    if (c[0] === "4") return "EKUITAS";
    if (c[0] === "5") return "PENDAPATAN";
    if (/^[67]/.test(c)) return "BEBAN";
    if (/^8[01]/.test(c)) return "PENDAPATAN";
    if (c.startsWith("82")) return "BEBAN";
    return null;
  }
  if (/^[1-5]\d{3,4}$/.test(c)) {
    return ({ "1": "ASET", "2": "LIABILITAS", "3": "EKUITAS", "4": "PENDAPATAN", "5": "BEBAN" } as const)[c[0] as "1"];
  }
  return null;
}

/** Contoh awalan kode baru untuk tiap kelompok — dipakai pesan error. */
export const AWALAN_TIPE: Record<TipeAkun, string> = {
  ASET: "1 atau 2", LIABILITAS: "3", EKUITAS: "4", PENDAPATAN: "5 atau 81", BEBAN: "6, 7 atau 82",
};

/** Kelompok Harga Pokok Penjualan (6xxxxx): dipisah dari beban operasional di Laba Rugi & dashboard. */
export const akunHpp = (code: string) => /^6\d{5}$/.test(String(code ?? "").trim());

/** Retur/diskon/potongan penjualan (52xxxx) adalah pengurang pendapatan: sah bersaldo Debit. */
export const kontraPendapatan = (code: string) => /^52\d{4}$/.test(String(code ?? "").trim());

/** Sisi saldo yang wajar untuk tiap kelompok. */
export const SISI_WAJAR: Record<TipeAkun, "D" | "K"> = {
  ASET: "D", LIABILITAS: "K", EKUITAS: "K", PENDAPATAN: "K", BEBAN: "D",
};

/**
 * Akun kontra dibatasi ke neraca, ditambah kelompok retur/diskon penjualan 52xxxx
 * (lihat kontraPendapatan); laporan dan tutup buku menghitung sisi Debit-nya sebagai
 * pengurang pendapatan.
 */
export const BOLEH_KONTRA: TipeAkun[] = ["ASET", "LIABILITAS", "EKUITAS"];

/** Jatah kode yang dialokasikan otomatis saat menambah rekening kas/bank
 *  (lib/transfer-kas → kodeAkunBerikutnya). Form manual tidak boleh menyerobot.
 *  Kas melanjutkan 110001–110022 dari bagan akun, bank melanjutkan 120001–120006. */
export const KODE_REKENING = {
  Kas: { min: 110023, max: 119999 },
  Bank: { min: 120007, max: 129999 },
} as const;
export const jatahRekening = (code: string) => {
  const n = Number(code);
  return Object.values(KODE_REKENING).some((r) => n >= r.min && n <= r.max);
};

/**
 * Kode yang dipakai KERAS di dalam kode program. Menonaktifkan atau menimpanya
 * berarti mematikan jalur uang yang memakainya — dan matinya tanpa suara.
 *
 * Satu sumber kebenaran; jangan disalin ke tempat lain.
 */
export const KODE_SISTEM: Record<string, string> = {
  "110003": "kas bawaan & selisih kas tutup shift",
  "120002": "bank bawaan untuk semua pembayaran non-tunai",
  "182004": "PPN Masukan (faktur pembelian & rekap PPN)",
  "150001": "piutang usaha klinik & faktur penjualan",
  "130009": "piutang marketplace",
  "182001": "piutang karyawan (kasbon)",
  "170001": "persediaan — dipakai hampir semua jalur stok",
  "160001": "uang muka pembelian",
  "200008": "aset tetap",
  "200015": "akumulasi penyusutan",
  "311001": "hutang usaha",
  "311003": "hutang belum difakturkan (penerimaan barang)",
  "314001": "uang muka penjualan",
  "312005": "PPN Keluaran",
  "410001": "modal pemilik (saldo awal & saldo awal rekening)",
  "420001": "laba ditahan (target jurnal penutup)",
  "510001": "pendapatan penjualan produk",
  "520002": "diskon penjualan — pengurang pendapatan bruto",
  "510002": "pendapatan jasa klinik",
  "810001": "pendapatan bunga bank (rekonsiliasi)",
  "810003": "laba pelepasan aset tetap",
  "810004": "pendapatan lain-lain (kelebihan kas tutup shift)",
  "600001": "beban pokok penjualan — juga penanda HPP di Laba Rugi & dashboard",
  "710001": "beban gaji",
  "720002": "beban listrik & air (kategori pengeluaran)",
  "740001": "beban perlengkapan (kategori pengeluaran)",
  "740003": "beban transportasi (kategori pengeluaran)",
  "740007": "beban perawatan aset (kategori pengeluaran)",
  "740020": "beban komisi marketplace",
  "760003": "beban operasional lain-lain (kategori pengeluaran)",
  "740010": "beban administrasi bank (transfer & rekonsiliasi)",
  "750004": "beban penyusutan",
  "820004": "rugi pelepasan aset tetap",
  "760002": "selisih kas tutup shift",
  "720010": "selisih persediaan (opname, penyesuaian & retur barang rusak)",
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
  if (!/^[1-8]\d{5}$/.test(code)) return "Kode akun baru harus 6 angka sesuai bagan akun, contoh 740021.";

  const tipe = d.type as TipeAkun;
  if (!TIPE_AKUN.includes(tipe)) return "Kelompok akun tidak dikenal.";

  const harusnya = tipeDariKode(code);
  if (harusnya !== tipe) {
    return `Kode ${code} termasuk kelompok ${harusnya ?? "yang tidak dikenal"}. Kelompok ${tipe} memakai awalan ${AWALAN_TIPE[tipe]}, atau ganti kelompoknya.`;
  }

  if (jatahRekening(code)) {
    return `Kode ${KODE_REKENING.Kas.min}–${KODE_REKENING.Kas.max} dan ${KODE_REKENING.Bank.min}–${KODE_REKENING.Bank.max} adalah jatah rekening kas/bank yang dibuat otomatis dari menu Kas & Bank → Rekening. Pakai kode lain.`;
  }

  if (akunSistem(code)) {
    return `Kode ${code} sudah dipakai sistem untuk ${KODE_SISTEM[code]}. Pilih kode lain.`;
  }

  if (!d.name.trim()) return "Nama akun wajib diisi.";
  if (d.name.trim().length > 80) return "Nama akun maksimal 80 huruf.";

  return validasiSisiSaldo(tipe, d.normal_balance, code);
}

/** Saldo normal boleh berlawanan HANYA untuk kelompok neraca (akun kontra) dan retur/diskon penjualan 52xxxx. */
export function validasiSisiSaldo(tipe: TipeAkun, normal: string, code = ""): string | null {
  if (normal !== "D" && normal !== "K") return "Saldo normal harus Debit atau Kredit.";
  const wajar = SISI_WAJAR[tipe];
  if (normal === wajar) return null;
  if (tipe === "PENDAPATAN" && kontraPendapatan(code)) return null;
  if (!BOLEH_KONTRA.includes(tipe)) {
    return `Akun ${tipe} harus bersaldo normal ${wajar === "D" ? "Debit" : "Kredit"}. Saldo terbalik di kelompok ini membuat angkanya berlipat saat tutup buku.`;
  }
  return null; // akun kontra neraca — sah, mis. 200015 Akumulasi Penyusutan
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
  if (berubah && tipeDariKode(lama.code) !== tipe) {
    return `Kode ${lama.code} termasuk kelompok ${tipeDariKode(lama.code) ?? "yang tidak dikenal"}. Kelompoknya tidak boleh berbeda dari kodenya.`;
  }
  return validasiSisiSaldo(tipe, d.normal_balance, lama.code);
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
