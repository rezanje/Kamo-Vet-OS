// Akuisisi & retensi pelanggan — logika murni, dites di __tests__/retensi.test.ts.
//
// Tiga pertanyaan Kamo Group yang dijawab di sini: berapa pelanggan baru tiap
// periode per cabang, berapa banyak transaksi yang datang dari orang baru vs
// pelanggan lama, dan siapa yang sudah lama tidak datang.
//
// Semua dihitung dari riwayat transaksi, bukan dari tanggal daftar di kartu
// pelanggan: orang yang didaftarkan admin tahun lalu tapi baru belanja bulan ini
// adalah pelanggan baru menurut ukuran yang berguna buat marketing.

export type Kunjungan = {
  customerId: string;
  tanggal: string;   // YYYY-MM-DD
  cabang: string;
};

export type ProfilPelanggan = {
  customerId: string;
  pertama: string;
  terakhir: string;
  /** Cabang tempat dia pertama kali bertransaksi — dipakai "pelanggan baru per cabang". */
  cabangPertama: string;
  /** Jumlah HARI kunjungan berbeda, bukan jumlah struk. */
  kunjungan: number;
  /** Rata-rata jarak antar kunjungan dalam hari. null = baru sekali datang. */
  rataInterval: number | null;
};

export function selisihHari(dari: string, sampai: string): number {
  const a = new Date(`${dari}T00:00:00Z`).getTime();
  const b = new Date(`${sampai}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 864e5);
}

/**
 * `kunjungan` boleh berisi banyak baris untuk satu orang di satu hari — hari yang
 * sama dihitung SEKALI. Dua struk dalam sehari bukan dua kunjungan; kalau dihitung
 * dua, rata-rata intervalnya jadi nol dan laporannya tidak berarti.
 */
export function profilPelanggan(kunjungan: Kunjungan[]): ProfilPelanggan[] {
  const per = new Map<string, { hari: Set<string>; cabangPerHari: Map<string, string> }>();
  for (const k of kunjungan) {
    if (!k.customerId) continue;
    const cur = per.get(k.customerId) ?? { hari: new Set<string>(), cabangPerHari: new Map<string, string>() };
    cur.hari.add(k.tanggal);
    if (!cur.cabangPerHari.has(k.tanggal)) cur.cabangPerHari.set(k.tanggal, k.cabang);
    per.set(k.customerId, cur);
  }

  const hasil: ProfilPelanggan[] = [];
  for (const [customerId, v] of per) {
    const hari = [...v.hari].sort();
    const pertama = hari[0];
    const terakhir = hari[hari.length - 1];
    hasil.push({
      customerId,
      pertama,
      terakhir,
      cabangPertama: v.cabangPerHari.get(pertama) ?? "—",
      kunjungan: hari.length,
      // Rata-rata jarak = rentang pertama→terakhir dibagi jumlah selanya.
      rataInterval: hari.length > 1 ? selisihHari(pertama, terakhir) / (hari.length - 1) : null,
    });
  }
  return hasil.sort((a, b) => a.pertama.localeCompare(b.pertama));
}

export type BarisAkuisisi = { cabang: string; baru: number };

/** Pelanggan yang transaksi PERTAMANYA jatuh di dalam rentang, dikelompokkan per cabang. */
export function pelangganBaru(profil: ProfilPelanggan[], dari: string, sampai: string): BarisAkuisisi[] {
  const per = new Map<string, number>();
  for (const p of profil) {
    if (p.pertama < dari || p.pertama > sampai) continue;
    per.set(p.cabangPertama, (per.get(p.cabangPertama) ?? 0) + 1);
  }
  return [...per].map(([cabang, baru]) => ({ cabang, baru })).sort((a, b) => b.baru - a.baru);
}

export type TrxRingkas = { customerId: string | null; tanggal: string; cabang: string; omzet: number };

export type BarisBaruLama = {
  cabang: string;
  baru: number; omzetBaru: number;
  lama: number; omzetLama: number;
  /** Struk tanpa identitas pembeli — tidak bisa dinilai baru atau lama. */
  takDikenal: number; omzetTakDikenal: number;
  rasioBaru: number;   // 0–1, dihitung dari transaksi yang teridentifikasi saja
};

/**
 * Transaksi di rentang dipilah: datang dari pelanggan yang baru pertama kali
 * bertransaksi di rentang ini, atau dari pelanggan lama.
 *
 * Rasio sengaja dihitung dari transaksi yang teridentifikasi saja. Struk pembeli
 * umum ikut dilaporkan tapi tidak ikut membagi — kalau ikut, rasionya terbaca
 * seolah pelanggan lama menyusut padahal cuma tidak dicatat namanya.
 */
export function baruVsLama(trx: TrxRingkas[], profil: ProfilPelanggan[], dari: string): BarisBaruLama[] {
  const pertamaPer = new Map(profil.map((p) => [p.customerId, p.pertama]));
  const per = new Map<string, BarisBaruLama>();

  const kosong = (cabang: string): BarisBaruLama => ({
    cabang, baru: 0, omzetBaru: 0, lama: 0, omzetLama: 0,
    takDikenal: 0, omzetTakDikenal: 0, rasioBaru: 0,
  });

  for (const t of trx) {
    const row = per.get(t.cabang) ?? kosong(t.cabang);
    const omzet = Number(t.omzet) || 0;
    if (!t.customerId) {
      row.takDikenal++;
      row.omzetTakDikenal += omzet;
    } else if ((pertamaPer.get(t.customerId) ?? t.tanggal) >= dari) {
      row.baru++;
      row.omzetBaru += omzet;
    } else {
      row.lama++;
      row.omzetLama += omzet;
    }
    per.set(t.cabang, row);
  }

  for (const row of per.values()) {
    const dikenal = row.baru + row.lama;
    row.rasioBaru = dikenal ? row.baru / dikenal : 0;
  }
  return [...per.values()].sort((a, b) => (b.baru + b.lama + b.takDikenal) - (a.baru + a.lama + a.takDikenal));
}

export type BarisDorman = ProfilPelanggan & { hariDiam: number };

/** Pelanggan yang kunjungan terakhirnya lebih lama dari `ambangHari` sebelum `asOf`. */
export function dorman(profil: ProfilPelanggan[], asOf: string, ambangHari: number): BarisDorman[] {
  const batas = Math.max(1, Math.floor(Number(ambangHari) || 0));
  return profil
    .map((p) => ({ ...p, hariDiam: selisihHari(p.terakhir, asOf) }))
    .filter((p) => p.hariDiam > batas)
    .sort((a, b) => b.hariDiam - a.hariDiam);
}

/** Rata-rata interval kunjungan seluruh pelanggan yang sudah datang lebih dari sekali. */
export function rataIntervalGabungan(profil: ProfilPelanggan[]): { rata: number | null; dihitungDari: number } {
  const punya = profil.filter((p) => p.rataInterval !== null);
  if (punya.length === 0) return { rata: null, dihitungDari: 0 };
  const total = punya.reduce((a, p) => a + (p.rataInterval as number), 0);
  return { rata: total / punya.length, dihitungDari: punya.length };
}
