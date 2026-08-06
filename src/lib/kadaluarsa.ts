// Status kadaluarsa stok — logika murni, dites di __tests__/kadaluarsa.test.ts.
//
// Ambangnya sengaja dua angka saja (30 & 90 hari): satu untuk "tarik dari rak
// sekarang", satu untuk "mulai didorong jualannya". Lebih banyak tingkat cuma
// bikin orang gudang ragu harus bertindak di warna yang mana.

export type StatusExp = "lewat" | "kritis" | "waspada" | "aman";

export const AMBANG_KRITIS = 30;
export const AMBANG_WASPADA = 90;

/** Selisih hari kalender antara dua tanggal YYYY-MM-DD (bisa negatif). */
export function selisihHari(dari: string, sampai: string): number {
  // UTC, bukan waktu lokal: tanggal kadaluarsa tidak boleh bergeser sehari
  // gara-gara server jalan di zona waktu lain.
  const utc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(sampai) - utc(dari)) / 86_400_000);
}

export function statusExp(expDate: string, hariIni: string): StatusExp {
  const sisa = selisihHari(hariIni, expDate);
  if (sisa < 0) return "lewat";
  if (sisa <= AMBANG_KRITIS) return "kritis";
  if (sisa <= AMBANG_WASPADA) return "waspada";
  return "aman";
}

export const LABEL_STATUS: Record<StatusExp, string> = {
  lewat: "Sudah kadaluarsa",
  kritis: "≤ 30 hari",
  waspada: "≤ 90 hari",
  aman: "Masih aman",
};

export const WARNA_STATUS: Record<StatusExp, { bg: string; fg: string }> = {
  lewat: { bg: "#fef2f2", fg: "#b91c1c" },
  kritis: { bg: "#fff7ed", fg: "#c2410c" },
  waspada: { bg: "#fffbeb", fg: "#b45309" },
  aman: { bg: "#e8f5ee", fg: "#15803d" },
};

export type LapisanStok = {
  itemId: string;
  namaBarang: string;
  gudang: string;
  qty: number;
  satuan: string;
  expDate: string;
  nilai: number;
};

export type BarisMonitor = LapisanStok & { status: StatusExp; sisaHari: number };

/**
 * Urut dari yang paling mendesak. Barang yang sudah lewat tanggal tetap
 * ditampilkan paling atas — selama masih ada qty-nya, dia masih di rak dan masih
 * bisa terjual/terpakai kalau tidak ditarik.
 */
export function susunMonitor(layers: LapisanStok[], hariIni: string): BarisMonitor[] {
  return layers
    .map((l) => ({ ...l, status: statusExp(l.expDate, hariIni), sisaHari: selisihHari(hariIni, l.expDate) }))
    .sort((a, b) => a.sisaHari - b.sisaHari);
}

export function ringkasMonitor(baris: BarisMonitor[]) {
  const per = (s: StatusExp) => baris.filter((b) => b.status === s);
  const nilai = (s: StatusExp) => per(s).reduce((a, b) => a + b.nilai, 0);
  return {
    lewat: per("lewat").length,
    kritis: per("kritis").length,
    waspada: per("waspada").length,
    nilaiLewat: nilai("lewat"),
    nilaiKritis: nilai("kritis"),
    /** Nilai barang yang sudah/hampir hangus — angka inilah yang bikin orang bertindak. */
    nilaiTerancam: nilai("lewat") + nilai("kritis"),
  };
}
