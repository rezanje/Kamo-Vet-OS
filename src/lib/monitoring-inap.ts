// Pemantauan harian rawat inap — logika murni, dites di __tests__/monitoring-inap.test.ts.
//
// Satu hari bisa punya BEBERAPA laporan: dokter mengisi tiap visit, dan visit bisa
// dua kali sehari. Jadi semua hitungan di sini bekerja atas DAFTAR laporan, lalu
// meringkasnya per tanggal — bukan mengandaikan satu baris per hari.

/**
 * Satu skala untuk makan, minum, BAB, dan BAK (keputusan drh. Ilham & Pak Aldi,
 * 24 Agustus).
 *
 * Sebelumnya tiap hal punya pilihan sendiri ("habis/sebagian/tidak mau",
 * "normal/cair/keras/berdarah"). Detail teksturnya memang lebih kaya, tapi tidak
 * bisa dijadikan grafik karena skalanya beda-beda — dan dokter tetap harus
 * menafsirkan sendiri. Sekarang keempatnya memakai skala yang sama; teksturnya
 * (diare, pasta, berdarah) ditulis di kolom keterangan.
 */
export const SKALA_ORDINAL = ["Baik", "Sedang", "Buruk"] as const;
export type NilaiOrdinal = (typeof SKALA_ORDINAL)[number];

export const OPSI_MAKAN = SKALA_ORDINAL;
export const OPSI_MINUM = SKALA_ORDINAL;
export const OPSI_BAB = SKALA_ORDINAL;
export const OPSI_PIPIS = SKALA_ORDINAL;
export const OPSI_KOMUNIKASI = ["WhatsApp", "Telepon", "Bertemu langsung"] as const;

/** Nilai lama dari catatan yang sudah telanjur tersimpan, dipetakan ke skala baru. */
const PETA_LAMA: Record<string, NilaiOrdinal> = {
  habis: "Baik", normal: "Baik",
  sebagian: "Sedang", sedikit: "Sedang", keras: "Sedang",
  "tidak mau": "Buruk", "tidak ada": "Buruk", cair: "Buruk", berdarah: "Buruk",
};

export function normalOrdinal(v: string | null | undefined): NilaiOrdinal | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const cocok = SKALA_ORDINAL.find((o) => o.toLowerCase() === t.toLowerCase());
  return cocok ?? PETA_LAMA[t.toLowerCase()] ?? null;
}

/** Baik 3 · Sedang 2 · Buruk 1 — dipakai grafik dan pembanding antar hari. */
export function skorOrdinal(v: string | null | undefined): number | null {
  const n = normalOrdinal(v);
  return n === "Baik" ? 3 : n === "Sedang" ? 2 : n === "Buruk" ? 1 : null;
}

export type LaporanHarian = {
  id: string;
  tanggal: string;              // YYYY-MM-DD
  waktu: string;                // ISO, dipakai mengurutkan laporan dalam satu hari
  makan: string | null;
  minum: string | null;
  bab: string | null;
  pipis: string | null;
  berat: number | null;
  suhu: number | null;
  fotoUrl: string | null;
  kondisi: string;
  tindakan: string | null;
  keterangan: string | null;
  komunikasiOwner: string | null;
  komunikasiVia: string | null;
  dokter: string | null;
};

export type RingkasanHari = {
  tanggal: string;
  jumlahLaporan: number;
  /** Nilai terakhir hari itu — yang paling menggambarkan kondisi saat shift berakhir. */
  makan: NilaiOrdinal | null;
  minum: NilaiOrdinal | null;
  berat: number | null;
  suhu: number | null;
  /** Nilai terakhir hari itu pada skala Baik/Sedang/Buruk; null = belum dicatat. */
  bab: NilaiOrdinal | null;
  pipis: NilaiOrdinal | null;
  foto: string[];
  komunikasi: { isi: string; via: string | null; oleh: string | null }[];
};

const terbaruDulu = (a: LaporanHarian, b: LaporanHarian) => (a.waktu < b.waktu ? 1 : -1);

/** Ringkas per tanggal, hari terbaru di atas. */
export function ringkasPerHari(laporan: LaporanHarian[]): RingkasanHari[] {
  const perTanggal = new Map<string, LaporanHarian[]>();
  for (const l of laporan) {
    const list = perTanggal.get(l.tanggal) ?? [];
    list.push(l);
    perTanggal.set(l.tanggal, list);
  }

  return [...perTanggal.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([tanggal, list]) => {
      const urut = [...list].sort(terbaruDulu);      // [0] = paling akhir hari itu
      const nilaiTerakhir = <K extends keyof LaporanHarian>(k: K) =>
        urut.find((l) => l[k] !== null && l[k] !== "")?.[k] ?? null;

      return {
        tanggal,
        jumlahLaporan: list.length,
        makan: normalOrdinal(nilaiTerakhir("makan") as string | null),
        minum: normalOrdinal(nilaiTerakhir("minum") as string | null),
        berat: nilaiTerakhir("berat") as number | null,
        suhu: nilaiTerakhir("suhu") as number | null,
        bab: normalOrdinal(nilaiTerakhir("bab") as string | null),
        pipis: normalOrdinal(nilaiTerakhir("pipis") as string | null),
        foto: urut.map((l) => l.fotoUrl).filter((f): f is string => !!f),
        komunikasi: urut
          .filter((l) => !!l.komunikasiOwner)
          .map((l) => ({ isi: l.komunikasiOwner as string, via: l.komunikasiVia, oleh: l.dokter })),
      };
    });
}

export type Streak = {
  /** Berapa hari berturut-turut bernilai Buruk, dihitung dari hari terbaru. */
  hari: number;
  /** Hitungannya berhenti karena harinya tidak tercatat, bukan karena membaik. */
  terhentiKarenaKosong: boolean;
};

export type JenisOrdinal = "makan" | "minum" | "bab" | "pipis";

/**
 * "Sudah berapa hari berturut-turut buruk."
 *
 * Hari yang TIDAK tercatat sengaja menghentikan hitungan dan ditandai: tidak ada
 * catatan bukan berarti keadaannya baik, dan menganggapnya baik bisa menunda
 * tindakan medis atas dasar data yang sebenarnya kosong.
 */
export function streakBuruk(hari: RingkasanHari[], jenis: JenisOrdinal): Streak {
  let n = 0;
  for (const h of hari) {                          // hari[0] = terbaru
    const nilai = h[jenis];
    if (nilai === null) return { hari: n, terhentiKarenaKosong: true };
    if (nilai !== "Buruk") return { hari: n, terhentiKarenaKosong: false };
    n++;
  }
  return { hari: n, terhentiKarenaKosong: false };
}

export type Tren = {
  terakhir: number | null;
  sebelumnya: number | null;
  delta: number | null;
  arah: "naik" | "turun" | "tetap" | "belum cukup data";
  /** Titik untuk grafik, urut dari lama ke baru. */
  titik: { tanggal: string; nilai: number }[];
};

export function trenAngka(hari: RingkasanHari[], jenis: "berat" | "suhu"): Tren {
  const titik = [...hari]
    .reverse()                                       // lama → baru untuk grafik
    .map((h) => ({ tanggal: h.tanggal, nilai: h[jenis] }))
    .filter((t): t is { tanggal: string; nilai: number } => t.nilai !== null);

  const terakhir = titik.at(-1)?.nilai ?? null;
  const sebelumnya = titik.at(-2)?.nilai ?? null;
  if (terakhir === null || sebelumnya === null) {
    return { terakhir, sebelumnya, delta: null, arah: "belum cukup data", titik };
  }
  const delta = Number((terakhir - sebelumnya).toFixed(2));
  return {
    terakhir, sebelumnya, delta,
    arah: delta > 0 ? "naik" : delta < 0 ? "turun" : "tetap",
    titik,
  };
}

// Rentang suhu normal anjing & kucing (38,0–39,2 °C). Dipakai untuk warna, bukan
// untuk diagnosis — dokter yang memutuskan.
/** Grafik untuk hal yang dinilai Baik/Sedang/Buruk — nilainya dipakai skornya. */
export function trenOrdinal(hari: RingkasanHari[], jenis: JenisOrdinal): Tren {
  const titik = [...hari]
    .reverse()
    .map((h) => ({ tanggal: h.tanggal, nilai: skorOrdinal(h[jenis]) }))
    .filter((t): t is { tanggal: string; nilai: number } => t.nilai !== null);

  const terakhir = titik.at(-1)?.nilai ?? null;
  const sebelumnya = titik.at(-2)?.nilai ?? null;
  if (terakhir === null || sebelumnya === null) {
    return { terakhir, sebelumnya, delta: null, arah: "belum cukup data", titik };
  }
  const delta = terakhir - sebelumnya;
  return {
    terakhir, sebelumnya, delta,
    arah: delta > 0 ? "naik" : delta < 0 ? "turun" : "tetap",
    titik,
  };
}

export const SUHU_NORMAL_MIN = 38.0;
export const SUHU_NORMAL_MAX = 39.2;

export function statusSuhu(suhu: number | null): "demam" | "normal" | "rendah" | "belum diukur" {
  if (suhu === null) return "belum diukur";
  if (suhu > SUHU_NORMAL_MAX) return "demam";
  if (suhu < SUHU_NORMAL_MIN) return "rendah";
  return "normal";
}

/** Hal yang perlu diperhatikan saat serah terima shift. Kosong = tidak ada peringatan. */
export function peringatan(hari: RingkasanHari[]): string[] {
  const pesan: string[] = [];
  if (hari.length === 0) return pesan;

  const LABEL: Record<JenisOrdinal, string> = {
    makan: "Makan", minum: "Minum", bab: "BAB", pipis: "BAK",
  };

  // Dua hari berturut-turut buruk lebih pantas ditindak daripada satu kali saja.
  for (const jenis of ["makan", "minum", "bab", "pipis"] as JenisOrdinal[]) {
    const s = streakBuruk(hari, jenis);
    if (s.hari >= 2) pesan.push(`${LABEL[jenis]} buruk ${s.hari} hari berturut-turut`);
    else if (hari[0][jenis] === "Buruk") pesan.push(`${LABEL[jenis]} buruk pada catatan terakhir`);
  }

  const suhu = trenAngka(hari, "suhu");
  const st = statusSuhu(suhu.terakhir);
  if (st === "demam") pesan.push(`Suhu terakhir ${suhu.terakhir}°C — di atas normal`);
  if (st === "rendah") pesan.push(`Suhu terakhir ${suhu.terakhir}°C — di bawah normal`);

  const berat = trenAngka(hari, "berat");
  // 5% dari berat badan dalam satu kali penimbangan sudah pantas dicurigai.
  if (berat.delta !== null && berat.sebelumnya && berat.delta < 0
      && Math.abs(berat.delta) / berat.sebelumnya >= 0.05) {
    pesan.push(`Berat turun ${Math.abs(berat.delta)} kg sejak penimbangan sebelumnya`);
  }

  return pesan;
}
