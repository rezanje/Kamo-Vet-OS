// Pertumbuhan anggota member per bulan — logika murni, dites di
// __tests__/pertumbuhan.test.ts.
//
// Yang dicari Kamo Group: berapa member baru tiap bulan DAN berapa totalnya sampai
// bulan itu. Angka kedua yang penting — "bulan ini dapat 12 member" tidak berarti apa-apa
// tanpa tahu totalnya sudah berapa.

export type TitikBulan = {
  bulan: string;      // YYYY-MM
  baru: number;
  kumulatif: number;
};

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export function labelBulan(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${BULAN[m - 1] ?? "?"} ${y}`;
}

/** Semua bulan YYYY-MM antara dua tanggal, inklusif. Dibatasi 120 bulan. */
export function rentangBulan(dari: string, sampai: string): string[] {
  const [ya, ma] = dari.slice(0, 7).split("-").map(Number);
  const [yb, mb] = sampai.slice(0, 7).split("-").map(Number);
  const hasil: string[] = [];
  let y = ya, m = ma;
  while ((y < yb || (y === yb && m <= mb)) && hasil.length < 120) {
    hasil.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return hasil;
}

/**
 * `tanggalGabung` = tanggal daftar semua member (boleh di luar rentang; yang lebih
 * lama dipakai menghitung kumulatif awal, bukan dibuang).
 */
export function pertumbuhanBulanan(tanggalGabung: string[], dari: string, sampai: string): TitikBulan[] {
  const bulanan = new Map<string, number>();
  for (const t of tanggalGabung) {
    const ym = String(t).slice(0, 7);
    if (!ym) continue;
    bulanan.set(ym, (bulanan.get(ym) ?? 0) + 1);
  }

  const bulan = rentangBulan(dari, sampai);
  if (bulan.length === 0) return [];

  // Kumulatif dimulai dari semua member yang sudah ada SEBELUM bulan pertama.
  let kumulatif = 0;
  for (const [ym, n] of bulanan) if (ym < bulan[0]) kumulatif += n;

  return bulan.map((ym) => {
    const baru = bulanan.get(ym) ?? 0;
    kumulatif += baru;
    return { bulan: ym, baru, kumulatif };
  });
}

export type RekapPoin = { terkumpul: number; ditukar: number; net: number };

/** delta positif = poin didapat, negatif = poin dipakai. */
export function rekapPoin(delta: number[]): RekapPoin {
  let terkumpul = 0, ditukar = 0;
  for (const d of delta) {
    const n = Number(d) || 0;
    if (n > 0) terkumpul += n; else ditukar += -n;
  }
  return { terkumpul, ditukar, net: terkumpul - ditukar };
}
