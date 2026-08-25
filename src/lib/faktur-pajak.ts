// Berkas pajak (S10) — logika murni, dites di __tests__/faktur-pajak.test.ts.
//
// Yang dikerjakan di sini: merapikan NPWP, menyusun daftar pajak keluaran & masukan
// satu masa, dan membentuk berkas CSV yang bisa dipakai staf pajak.
//
// Yang SENGAJA TIDAK dikerjakan: membuat berkas impor Coretax/e-Faktur jadi. Tata
// letak berkas itu ditentukan DJP dan berubah-ubah; menebaknya berarti berkas yang
// ditolak saat pelaporan — dan yang menanggung akibatnya klien, bukan aplikasi.
// Yang dikeluarkan adalah SELURUH isian yang dibutuhkan, dalam satu tabel yang jelas,
// supaya staf pajak tinggal memindahkannya ke template resmi yang mereka pegang.

/** NPWP disimpan apa adanya, dibandingkan hanya dari angkanya. */
export function digitNpwp(v: string | null | undefined): string {
  return String(v ?? "").replace(/\D/g, "");
}

/**
 * NPWP sah kalau 15 digit (format lama) atau 16 digit (NPWP 16 digit / NIK sejak 2024).
 * Panjang lain hampir pasti salah ketik dan lebih baik ketahuan sekarang daripada
 * saat berkasnya ditolak.
 */
export function npwpSah(v: string | null | undefined): boolean {
  const d = digitNpwp(v);
  return d.length === 15 || d.length === 16;
}

/** 15 digit dirapikan jadi 00.000.000.0-000.000; 16 digit ditulis apa adanya. */
export function formatNpwp(v: string | null | undefined): string {
  const d = digitNpwp(v);
  if (d.length !== 15) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}.${d.slice(8, 9)}-${d.slice(9, 12)}.${d.slice(12, 15)}`;
}

export type BarisPajak = {
  /** Nomor dokumen kita (faktur penjualan / faktur pembelian). */
  nomor: string;
  tanggal: string;
  /** Lawan transaksi: pelanggan untuk keluaran, pemasok untuk masukan. */
  pihak: string;
  npwp: string | null;
  alamat: string | null;
  /** Nomor faktur pajak dari pemasok — hanya untuk pajak masukan. */
  noFakturPajak: string | null;
  dpp: number;
  ppn: number;
};

export type RingkasMasa = {
  masa: string;
  keluaranDpp: number; keluaranPpn: number;
  masukanDpp: number; masukanPpn: number;
  /** Positif = kurang bayar (harus disetor), negatif = lebih bayar. */
  netto: number;
};

export function ringkasMasa(masa: string, keluaran: BarisPajak[], masukan: BarisPajak[]): RingkasMasa {
  const jml = (rows: BarisPajak[], k: "dpp" | "ppn") => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const keluaranPpn = jml(keluaran, "ppn");
  const masukanPpn = jml(masukan, "ppn");
  return {
    masa,
    keluaranDpp: jml(keluaran, "dpp"), keluaranPpn,
    masukanDpp: jml(masukan, "dpp"), masukanPpn,
    netto: keluaranPpn - masukanPpn,
  };
}

export type MasalahBerkas = { hal: string; jumlah: number; pesan: string };

/**
 * Apa yang membuat berkas belum layak dilaporkan. Ditampilkan apa adanya, bukan
 * disembunyikan: berkas yang kelihatan "berhasil dibuat" padahal identitasnya kosong
 * jauh lebih berbahaya daripada peringatan yang mengganggu.
 */
export function periksaKesiapan(o: {
  npwpPerusahaan: string | null;
  namaPerusahaan: string | null;
  keluaran: BarisPajak[];
  masukan: BarisPajak[];
}): MasalahBerkas[] {
  const masalah: MasalahBerkas[] = [];

  if (!npwpSah(o.npwpPerusahaan)) {
    masalah.push({
      hal: "npwp-perusahaan", jumlah: 1,
      pesan: "NPWP perusahaan belum diisi (atau jumlah digitnya salah) — isi di Pengaturan → Pajak.",
    });
  }
  if (!String(o.namaPerusahaan ?? "").trim()) {
    masalah.push({
      hal: "nama-perusahaan", jumlah: 1,
      pesan: "Nama perusahaan belum diisi — isi di Pengaturan → Pajak.",
    });
  }

  const npwpKosong = o.keluaran.filter((r) => !npwpSah(r.npwp)).length;
  if (npwpKosong > 0) {
    masalah.push({
      hal: "npwp-pelanggan", jumlah: npwpKosong,
      pesan: `${npwpKosong} faktur keluaran belum punya NPWP pembeli. Untuk pembeli tanpa NPWP itu wajar, tapi penjualan ke perusahaan harus ada NPWP-nya.`,
    });
  }

  const tanpaNoFaktur = o.masukan.filter((r) => !String(r.noFakturPajak ?? "").trim()).length;
  if (tanpaNoFaktur > 0) {
    masalah.push({
      hal: "no-faktur-pemasok", jumlah: tanpaNoFaktur,
      pesan: `${tanpaNoFaktur} faktur masukan belum diisi nomor faktur pajak pemasoknya — tanpa itu PPN-nya tidak bisa dikreditkan.`,
    });
  }

  return masalah;
}

const KOLOM_CSV = [
  "jenis", "no_dokumen", "tanggal", "nama_lawan_transaksi", "npwp", "alamat",
  "no_faktur_pajak", "dpp", "ppn",
] as const;

/** Sel CSV: tanda kutip dipakai kalau isinya mengandung pemisah, kutip, atau baris baru. */
function sel(v: string | number | null): string {
  const t = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function berkasCsv(keluaran: BarisPajak[], masukan: BarisPajak[]): string {
  const baris = [
    ...keluaran.map((r) => ["Keluaran", r] as const),
    ...masukan.map((r) => ["Masukan", r] as const),
  ].map(([jenis, r]) => [
    jenis, r.nomor, r.tanggal, r.pihak,
    formatNpwp(r.npwp), r.alamat ?? "", r.noFakturPajak ?? "",
    Math.round(r.dpp), Math.round(r.ppn),
  ].map(sel).join(","));

  return [KOLOM_CSV.join(","), ...baris].join("\n");
}

export function namaBerkas(masa: string): string {
  return `pajak-${masa}.csv`;
}
