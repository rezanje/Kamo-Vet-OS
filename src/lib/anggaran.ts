// Anggaran & serapan (migrasi 0099) — murni, dites di __tests__/anggaran.test.ts

export type BarisAnggaran = { coaCode: string; jumlah: number };
export type TransferAnggaran = { dariCoa: string; keCoa: string; jumlah: number };

/**
 * Anggaran efektif setelah pergeseran.
 *
 * Transfer disimpan sebagai dokumen terpisah, jadi angka anggaran aslinya tetap
 * terbaca. Yang dipakai membandingkan realisasi adalah hasil akhirnya.
 * Akun tujuan yang belum punya anggaran ikut muncul — itu memang tujuannya:
 * memberi jatah ke pos yang semula nol.
 */
export function anggaranEfektif(
  dasar: BarisAnggaran[],
  transfer: TransferAnggaran[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of dasar) out.set(b.coaCode, (out.get(b.coaCode) ?? 0) + Number(b.jumlah));
  for (const t of transfer) {
    const n = Number(t.jumlah) || 0;
    out.set(t.dariCoa, (out.get(t.dariCoa) ?? 0) - n);
    out.set(t.keCoa, (out.get(t.keCoa) ?? 0) + n);
  }
  return out;
}

/**
 * Realisasi satu akun dari baris jurnal.
 *
 * Beban bertambah di sisi debit, jadi realisasi = debit − kredit. Pengurangnya
 * (koreksi, pembalikan) ikut terhitung, kalau tidak satu jurnal pembalikan akan
 * terlihat seperti beban dua kali.
 */
export function realisasiAkun(baris: { debit: number; credit: number }[]): number {
  return Math.round(baris.reduce((a, b) => a + (Number(b.debit) || 0) - (Number(b.credit) || 0), 0));
}

export type StatusSerapan = "aman" | "waspada" | "lewat";

/** Ambang waspada 85%: masih ada ruang, tapi sudah waktunya dilihat. */
export function statusSerapan(anggaran: number, realisasi: number): StatusSerapan {
  const a = Number(anggaran) || 0;
  const r = Number(realisasi) || 0;
  if (a <= 0) return r > 0 ? "lewat" : "aman";
  const persen = (r / a) * 100;
  if (persen > 100) return "lewat";
  return persen >= 85 ? "waspada" : "aman";
}

export type RingkasanPos = {
  coaCode: string;
  anggaran: number;
  realisasi: number;
  sisa: number;
  persen: number;
  status: StatusSerapan;
};

export function ringkasSerapan(
  anggaran: Map<string, number>,
  realisasi: Map<string, number>,
): RingkasanPos[] {
  // Akun yang cuma punya realisasi tanpa anggaran tetap ditampilkan — pengeluaran
  // di luar rencana justru yang paling perlu kelihatan.
  const kode = new Set([...anggaran.keys(), ...realisasi.keys()]);

  return [...kode].map((coaCode) => {
    const a = Math.round(anggaran.get(coaCode) ?? 0);
    const r = Math.round(realisasi.get(coaCode) ?? 0);
    return {
      coaCode,
      anggaran: a,
      realisasi: r,
      sisa: a - r,
      persen: a > 0 ? Math.round((r / a) * 100) : 0,
      status: statusSerapan(a, r),
    };
  }).sort((x, y) => y.realisasi - x.realisasi);
}

/**
 * Transfer boleh jalan kalau pos asalnya masih punya sisa yang belum terpakai.
 * Menggeser jatah yang sudah terlanjur dibelanjakan cuma memindahkan masalah:
 * pos asal langsung jadi over-budget begitu transfernya disimpan.
 */
export function bolehTransfer(
  anggaranAsal: number,
  realisasiAsal: number,
  jumlah: number,
): { boleh: boolean; maksimal: number } {
  const maksimal = Math.max(0, Math.round((Number(anggaranAsal) || 0) - (Number(realisasiAsal) || 0)));
  return { boleh: Number(jumlah) > 0 && Number(jumlah) <= maksimal, maksimal };
}
