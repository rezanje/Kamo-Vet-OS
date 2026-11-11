// Perbandingan per cabang vs bulan lalu (permintaan Mas Mai, 11 Nov 2026).
//
// Semua angka di blok ini dibandingkan dengan RENTANG TANGGAL YANG SAMA bulan lalu:
// 1–15 Nov dibanding 1–15 Okt, "hari ini" 15 Nov dibanding 15 Okt. Bagian murni
// (tanpa database) dipisah di sini supaya aturan tanggal dan hitungannya bisa dites.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parse(value: string): { year: number; month: number; day: number } {
  if (!DATE_RE.test(value)) throw new Error("Tanggal tidak valid");
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > lastDay(year, month)) throw new Error("Tanggal tidak valid");
  return { year, month, day };
}

/**
 * Tanggal yang sama bulan lalu. Tanggal yang tidak ada di bulan lalu (31 Mar → Feb)
 * jatuh ke hari terakhir bulan itu. Akhir bulan tetap akhir bulan: 30 Nov → 31 Okt,
 * supaya "1–30 Nov" dibanding SEBULAN PENUH Oktober, bukan 1–30 Okt.
 */
export function samaTanggalBulanLalu(value: string): string {
  const { year, month, day } = parse(value);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevLast = lastDay(prevYear, prevMonth);
  const prevDay = day === lastDay(year, month) ? prevLast : Math.min(day, prevLast);
  return `${prevYear}-${pad(prevMonth)}-${pad(prevDay)}`;
}

export function rentangBulanLalu(from: string, to: string): { from: string; to: string } {
  return { from: samaTanggalBulanLalu(from), to: samaTanggalBulanLalu(to) };
}

/** Persen naik/turun. Null bila bulan lalu kosong (0) atau salah satu angka belum tersedia. */
export function pertumbuhan(sekarang: number | null, bulanLalu: number | null): number | null {
  if (sekarang === null || bulanLalu === null || bulanLalu === 0) return null;
  return ((sekarang - bulanLalu) / Math.abs(bulanLalu)) * 100;
}

// ---------- Penjualan petshop / klinik ----------

/** Satu transaksi (struk kasir/online atau tagihan klinik) setelah dikurangi retur/refund. */
export type DokumenUnit = {
  unit: "petshop" | "klinik";
  documentId: string;
  branchId: string;
  customerId: string | null;
  net: number;
};

export type AngkaUnit = {
  transaksi: number;
  omzet: number;
  /** Rata-rata nilai per transaksi; null bila belum ada transaksi. */
  rataRata: number | null;
  /** Customer berbeda yang bertransaksi (transaksi tanpa customer tidak ikut dihitung). */
  customer: number;
};

function hitungUnit(docs: DokumenUnit[]): AngkaUnit {
  const ids = new Set<string>();
  const customers = new Set<string>();
  let omzet = 0;
  for (const doc of docs) {
    ids.add(doc.documentId);
    omzet += Number(doc.net) || 0;
    if (doc.customerId) customers.add(doc.customerId);
  }
  return { transaksi: ids.size, omzet, rataRata: ids.size ? omzet / ids.size : null, customer: customers.size };
}

export type AngkaCabang = {
  petshop: AngkaUnit;
  klinik: AngkaUnit;
  grooming: number;
};

/** Per cabang + baris total ("*"). Customer di total dihitung unik lintas cabang. */
export function rekapPerCabang(
  branchIds: string[],
  docs: DokumenUnit[],
  grooming: Map<string, number>,
): Map<string, AngkaCabang> {
  const out = new Map<string, AngkaCabang>();
  const inScope = new Set(branchIds);
  const scoped = docs.filter((doc) => inScope.has(doc.branchId));
  const build = (rows: DokumenUnit[], groom: number): AngkaCabang => ({
    petshop: hitungUnit(rows.filter((doc) => doc.unit === "petshop")),
    klinik: hitungUnit(rows.filter((doc) => doc.unit === "klinik")),
    grooming: groom,
  });
  for (const id of branchIds) out.set(id, build(scoped.filter((doc) => doc.branchId === id), grooming.get(id) ?? 0));
  const totalGrooming = branchIds.reduce((sum, id) => sum + (grooming.get(id) ?? 0), 0);
  out.set("*", build(scoped, totalGrooming));
  return out;
}

// ---------- Nilai stok (HPP) ----------

export type UnitGudang = "petshop" | "klinik";

/** Gudang VET = klinik; RETAIL & ONLINE = petshop. DC, EXPIRED, TRANSIT tidak dihitung. */
export function unitGudang(type: string | null | undefined): UnitGudang | null {
  if (type === "VET") return "klinik";
  if (type === "RETAIL" || type === "ONLINE") return "petshop";
  return null;
}

export type MutasiNilai = { warehouseId: string; tanggal: string; qty: number; unitCost: number; valuationAdjustment: number };

/** Perubahan nilai persediaan yang dibawa satu mutasi (aturan yang sama dengan pencatat HPP). */
export function nilaiMutasi(move: MutasiNilai): number {
  return (Number(move.qty) || 0) * (Number(move.unitCost) || 0) + (Number(move.valuationAdjustment) || 0);
}

export type NilaiStok = { petshop: number; klinik: number };

/**
 * Nilai stok akhir hari `tanggal` per cabang + total ("*"), dihitung mundur dari nilai
 * HPP saat ini: nilai sekarang dikurangi semua mutasi yang tanggalnya SESUDAH `tanggal`.
 * `nilaiSekarang` = nilai per gudang hari ini.
 */
export function nilaiStokPadaTanggal(input: {
  tanggal: string;
  warehouses: { id: string; branchId: string; type: string | null }[];
  nilaiSekarang: Map<string, number>;
  mutasi: MutasiNilai[];
  branchIds: string[];
}): Map<string, NilaiStok> {
  const perGudang = new Map<string, number>(input.nilaiSekarang);
  for (const move of input.mutasi) {
    if (move.tanggal <= input.tanggal) continue;
    perGudang.set(move.warehouseId, (perGudang.get(move.warehouseId) ?? 0) - nilaiMutasi(move));
  }
  const out = new Map<string, NilaiStok>();
  for (const id of [...input.branchIds, "*"]) out.set(id, { petshop: 0, klinik: 0 });
  const inScope = new Set(input.branchIds);
  for (const warehouse of input.warehouses) {
    const unit = unitGudang(warehouse.type);
    if (!unit || !inScope.has(warehouse.branchId)) continue;
    const value = perGudang.get(warehouse.id) ?? 0;
    out.get(warehouse.branchId)![unit] += value;
    out.get("*")![unit] += value;
  }
  return out;
}
