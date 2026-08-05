// Kunjungan serombongan di layar pembayaran — satu pemilik, satu hari, beberapa hewan.
// Murni, dites di __tests__/rombongan-tagihan.test.ts
//
// Rombongan TIDAK disimpan sebagai satu dokumen. Ikatannya diturunkan dari data yang
// sudah ada: pemilik yang sama, cabang yang sama, tanggal yang sama. Menyimpan
// "id rombongan" sendiri berarti satu tabel lagi yang bisa melenceng dari kunjungannya,
// padahal tiga hal itu sudah cukup mengenali satu kedatangan.

export type KunjunganSerombongan = {
  visitId: string;
  hewan: string;
  /** null = tagihannya belum dibuat sama sekali. */
  invoiceNo: string | null;
  total: number;
  /** 'Lunas' | 'DP' | 'Belum Lunas' | null (belum ada tagihan) */
  paidStatus: string | null;
  dibayar: number;
};

export type RingkasanRombongan = {
  jumlahPasien: number;
  totalTagihan: number;
  totalDibayar: number;
  sisa: number;
  /** Semua tagihan sudah lunas — struk gabungan boleh dicetak sebagai bukti final. */
  semuaLunas: boolean;
  /** Ada kunjungan yang tagihannya belum dibuat — jangan bilang "selesai" dulu. */
  adaBelumDitagih: boolean;
};

export function ringkasTagihanRombongan(baris: KunjunganSerombongan[]): RingkasanRombongan {
  const totalTagihan = baris.reduce((a, b) => a + (Number(b.total) || 0), 0);
  const totalDibayar = baris.reduce((a, b) => a + (Number(b.dibayar) || 0), 0);

  return {
    jumlahPasien: baris.length,
    totalTagihan,
    totalDibayar,
    sisa: Math.max(0, totalTagihan - totalDibayar),
    // Kunjungan tanpa tagihan tidak boleh dihitung lunas — belum ada apa-apa untuk dilunasi.
    semuaLunas: baris.length > 0 && baris.every((b) => b.paidStatus === "Lunas"),
    adaBelumDitagih: baris.some((b) => b.invoiceNo === null),
  };
}

/** Label status per baris untuk panel rombongan. */
export function labelStatus(b: KunjunganSerombongan): string {
  if (b.invoiceNo === null) return "Belum ditagih";
  if (b.paidStatus === "Lunas") return "Lunas";
  if (b.paidStatus === "DP") return "DP";
  return "Belum lunas";
}

/** Kunjungan berikutnya yang masih perlu diproses kasir, selain yang sedang dibuka. */
export function berikutnyaBelumSelesai(
  baris: KunjunganSerombongan[],
  visitIdSekarang: string,
): KunjunganSerombongan | null {
  return baris.find((b) => b.visitId !== visitIdSekarang && b.paidStatus !== "Lunas") ?? null;
}
