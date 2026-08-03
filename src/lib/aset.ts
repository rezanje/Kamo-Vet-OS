// Aset tetap lanjutan (migrasi 0097) — murni, dites di __tests__/aset.test.ts
//
// Dua hal yang dipisahkan di sini:
//   1. Penyusutan FISKAL (untuk SPT) yang aturannya beda dari penyusutan komersial.
//   2. Jurnal pelepasan aset — bagian yang paling gampang salah karena melibatkan
//      penghapusan akumulasi penyusutan, bukan cuma mengeluarkan harga perolehan.

export const AKUN_ASET = "1501";
export const AKUN_AKUM_PENYUSUTAN = "1509";
export const AKUN_LABA_PELEPASAN = "4302";
export const AKUN_RUGI_PELEPASAN = "5602";

export type MetodeFiskal = "garis_lurus" | "saldo_menurun";

export type GolonganPajak = {
  umurBulan: number;
  metode: MetodeFiskal;
  tarifPersen: number;      // per tahun, hanya dipakai metode saldo menurun
};

/**
 * Penyusutan fiskal setahun penuh, per tahun ke-n (1 = tahun pertama).
 *
 * Garis lurus: harga perolehan dibagi rata sepanjang masa manfaat.
 * Saldo menurun: tarif dikali NILAI BUKU awal tahun, dan **tahun terakhir menyusutkan
 * habis sisanya** — itu aturan Pasal 11 UU PPh, tanpa itu selalu tersisa nilai buku
 * yang tidak pernah bisa dibiayakan.
 *
 * Nilai sisa tidak dipakai: fiskal menyusutkan sampai nol.
 */
export function penyusutanFiskalTahunKe(harga: number, g: GolonganPajak, tahun: number): number {
  const h = Math.max(0, Number(harga) || 0);
  const tahunTotal = Math.ceil(g.umurBulan / 12);
  if (h <= 0 || tahun < 1 || tahun > tahunTotal) return 0;

  if (g.metode === "garis_lurus") {
    // Tahun terakhir menutup sisa pembulatan supaya totalnya persis harga perolehan.
    const per = Math.round(h / tahunTotal);
    return tahun === tahunTotal ? h - per * (tahunTotal - 1) : per;
  }

  const tarif = Math.max(0, Number(g.tarifPersen) || 0) / 100;
  let nilaiBuku = h;
  for (let t = 1; t < tahun; t++) nilaiBuku -= Math.round(nilaiBuku * tarif);
  return tahun === tahunTotal ? Math.max(0, Math.round(nilaiBuku)) : Math.round(nilaiBuku * tarif);
}

/** Akumulasi penyusutan fiskal sampai tahun ke-n, dibatasi harga perolehan. */
export function akumulasiFiskal(harga: number, g: GolonganPajak, sampaiTahun: number): number {
  let total = 0;
  for (let t = 1; t <= sampaiTahun; t++) total += penyusutanFiskalTahunKe(harga, g, t);
  return Math.min(Math.max(0, Number(harga) || 0), total);
}

/** Tahun ke berapa aset berjalan pada tanggal tertentu (1 = tahun perolehan). */
export function tahunBerjalan(tanggalPerolehan: string, asOf: string): number {
  const a = new Date(`${tanggalPerolehan}T00:00:00`);
  const b = new Date(`${asOf}T00:00:00`);
  return b.getFullYear() - a.getFullYear() + 1;
}

// ── Pelepasan aset ────────────────────────────────────────────────────────────

export type JurnalLine = { code: string; debit: number; credit: number };

export function nilaiBuku(hargaPerolehan: number, akumulasi: number): number {
  return Math.max(0, Math.round((Number(hargaPerolehan) || 0) - (Number(akumulasi) || 0)));
}

/**
 * Jurnal pelepasan aset.
 *
 *   Dr Akumulasi Penyusutan   (menghapus akumulasi yang menempel di aset ini)
 *   Dr Kas/Bank               (kalau dijual)
 *   Cr Aset Tetap             (harga perolehan penuh, bukan nilai bukunya)
 *   Dr/Cr Laba atau Rugi Pelepasan  (selisihnya)
 *
 * Kesalahan yang dicegah: mengkredit aset sebesar nilai buku saja akan meninggalkan
 * akumulasi penyusutan menggantung di neraca untuk aset yang sudah tidak ada.
 */
export function jurnalPelepasan(
  hargaPerolehan: number,
  akumulasi: number,
  hargaJual: number,
  kasCode: string,
): JurnalLine[] {
  const harga = Math.round(Number(hargaPerolehan) || 0);
  const akum = Math.min(harga, Math.max(0, Math.round(Number(akumulasi) || 0)));
  const jual = Math.max(0, Math.round(Number(hargaJual) || 0));
  if (harga <= 0) return [];

  const buku = harga - akum;
  const labaRugi = jual - buku;

  const lines: JurnalLine[] = [];
  if (akum > 0) lines.push({ code: AKUN_AKUM_PENYUSUTAN, debit: akum, credit: 0 });
  if (jual > 0) lines.push({ code: kasCode, debit: jual, credit: 0 });
  lines.push({ code: AKUN_ASET, debit: 0, credit: harga });

  if (labaRugi > 0) lines.push({ code: AKUN_LABA_PELEPASAN, debit: 0, credit: labaRugi });
  else if (labaRugi < 0) lines.push({ code: AKUN_RUGI_PELEPASAN, debit: -labaRugi, credit: 0 });

  return lines;
}

/** Jurnal perbaikan besar yang menambah nilai perolehan aset. */
export function jurnalTambahNilai(tambahan: number, kasCode: string): JurnalLine[] {
  const n = Math.round(Number(tambahan) || 0);
  if (n <= 0) return [];
  return [
    { code: AKUN_ASET, debit: n, credit: 0 },
    { code: kasCode, debit: 0, credit: n },
  ];
}
