// Pengelompokan diagnosa & anamnesa yang diketik bebas — logika murni,
// dites di __tests__/diagnosa.test.ts.
//
// Diagnosa ditulis tangan oleh dokter, jadi "Gastritis", "gastritis", dan
// "Gastritis  " adalah penyakit yang sama. Tanpa penyeragaman, daftar penyakit
// terbanyak terpecah jadi beberapa baris kecil dan tidak ada yang kelihatan menonjol.

export type BarisDiagnosa = {
  /** Ejaan yang paling sering dipakai — itu yang ditampilkan. */
  nama: string;
  jumlah: number;
  /** Ejaan lain untuk istilah yang sama; kosong berarti penulisannya sudah konsisten. */
  ejaanLain: string[];
};

/** Huruf kecil, spasi ganda dirapikan, tanda baca di ujung dibuang. */
export function samakan(teks: string): string {
  return String(teks ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:-]+|[\s.,;:-]+$/g, "")
    .trim();
}

export function kelompokDiagnosa(daftar: (string | null | undefined)[]): BarisDiagnosa[] {
  const per = new Map<string, Map<string, number>>();
  for (const raw of daftar) {
    const kunci = samakan(raw ?? "");
    if (!kunci) continue;
    const asli = String(raw).trim().replace(/\s+/g, " ");
    const ejaan = per.get(kunci) ?? new Map<string, number>();
    ejaan.set(asli, (ejaan.get(asli) ?? 0) + 1);
    per.set(kunci, ejaan);
  }

  const hasil: BarisDiagnosa[] = [];
  for (const ejaan of per.values()) {
    const urut = [...ejaan].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    hasil.push({
      nama: urut[0][0],
      jumlah: urut.reduce((a, [, n]) => a + n, 0),
      ejaanLain: urut.slice(1).map(([t]) => t),
    });
  }
  return hasil.sort((a, b) => b.jumlah - a.jumlah || a.nama.localeCompare(b.nama));
}
