// Umur piutang/hutang (aging) — bucket standar: current / 1-30 / 31-60 / 61-90 / >90 hari.

export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_LABEL: Record<AgingBucket, string> = {
  current: "Berjalan",
  d1_30: "1–30 hari",
  d31_60: "31–60 hari",
  d61_90: "61–90 hari",
  d90plus: "> 90 hari",
};

export function agingDays(tanggal: string, asOf: string): number {
  const a = new Date(tanggal + "T00:00:00").getTime();
  const b = new Date(asOf + "T00:00:00").getTime();
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

export function agingBucket(tanggal: string, asOf: string): AgingBucket {
  const d = agingDays(tanggal, asOf);
  if (d === 0) return "current";
  if (d <= 30) return "d1_30";
  if (d <= 60) return "d31_60";
  if (d <= 90) return "d61_90";
  return "d90plus";
}

// Penyusutan garis lurus per bulan. 0 kalau umur tidak valid.
export function depreciationPerMonth(hargaPerolehan: number, nilaiSisa: number, umurBulan: number): number {
  if (umurBulan <= 0) return 0;
  return Math.max(0, Math.round((hargaPerolehan - nilaiSisa) / umurBulan));
}

// Jumlah bulan penyusutan yang sudah berjalan dari perolehan s/d periode (YYYY-MM), inklusif,
// dibatasi umur ekonomis. Bulan perolehan dihitung sebagai bulan pertama.
export function monthsElapsed(tanggalPerolehan: string, periode: string): number {
  const [py, pm] = periode.split("-").map(Number);
  const d = new Date(tanggalPerolehan + "T00:00:00");
  return (py - d.getFullYear()) * 12 + (pm - (d.getMonth() + 1)) + 1;
}
