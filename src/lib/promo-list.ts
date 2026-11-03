// Daftar promo (CRM → Promo): filter status, hitungan, urutan, pencarian, dan
// format rentang tanggal. Murni — status tetap berasal dari satu-satunya sumber
// kebenaran, promoScheduleStatus (lib/promo), jadi layar & kasir tidak bisa beda.
import { promoScheduleStatus, type PromoRow } from "./promo";

export type PromoStatusFilter = "aktif" | "mendatang" | "nonaktif" | "kedaluwarsa" | "semua";
type Jadwal = ReturnType<typeof promoScheduleStatus>;

export const PROMO_STATUS_FILTERS: { key: PromoStatusFilter; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "aktif", label: "Aktif" },
  { key: "mendatang", label: "Mendatang" },
  { key: "nonaktif", label: "Nonaktif" },
  { key: "kedaluwarsa", label: "Kedaluwarsa" },
];

// Status baris (bahasa kode) → kunci filter. "terjadwal" di lencana baris = "Mendatang".
const KUNCI: Record<Jadwal, Exclude<PromoStatusFilter, "semua">> = {
  aktif: "aktif", terjadwal: "mendatang", nonaktif: "nonaktif", kadaluarsa: "kedaluwarsa",
};
const URUTAN: Record<Jadwal, number> = { aktif: 0, terjadwal: 1, nonaktif: 2, kadaluarsa: 3 };

/** Nilai ?status= yang tak dikenal jatuh ke "semua" — tidak pernah menyembunyikan baris. */
export function parseStatusFilter(raw: string | string[] | undefined): PromoStatusFilter {
  return PROMO_STATUS_FILTERS.some(f => f.key === raw) ? (raw as PromoStatusFilter) : "semua";
}

/** Saling lepas: aktif + mendatang + nonaktif + kedaluwarsa = semua. Kedaluwarsa menang atas Nonaktif. */
export function promoStatusCounts(rows: PromoRow[], today: string): Record<PromoStatusFilter, number> {
  const c: Record<PromoStatusFilter, number> = { semua: rows.length, aktif: 0, mendatang: 0, nonaktif: 0, kedaluwarsa: 0 };
  for (const p of rows) c[KUNCI[promoScheduleStatus(p, today)]]++;
  return c;
}

export function filterPromosByStatus(rows: PromoRow[], filter: PromoStatusFilter, today: string): PromoRow[] {
  return filter === "semua" ? rows : rows.filter(p => KUNCI[promoScheduleStatus(p, today)] === filter);
}

/** Aktif → mendatang → nonaktif → kedaluwarsa; urutan asal terjaga di dalam kelompok. Input tidak diubah. */
export function sortPromosByStatus(rows: PromoRow[], today: string): PromoRow[] {
  return rows.map((p, i) => ({ p, i, o: URUTAN[promoScheduleStatus(p, today)] }))
    .sort((a, b) => a.o - b.o || a.i - b.i).map(x => x.p);
}

/** Promo berlaku di cabang itu: promo semua cabang (null / kosong) selalu ikut; tanpa pilihan cabang = semua. */
export function promoMatchesBranch(p: Pick<PromoRow, "branch_ids">, branchId: string): boolean {
  if (!branchId) return true;
  return !p.branch_ids || p.branch_ids.length === 0 || p.branch_ids.includes(branchId);
}

/** Cocok bila nama promo atau salah satu nama barang targetnya memuat kata kunci. Kosong = cocok semua. */
export function promoMatchesQuery(name: string, itemNames: string[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return name.toLowerCase().includes(q) || itemNames.some(n => n.toLowerCase().includes(q));
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
// Tanggal diolah sebagai teks, bukan Date: tidak ada geseran zona waktu.
function bagian(iso: string): { d: string; m: string; y: string } | null {
  const m = ISO.exec(iso);
  const bulan = m ? BULAN[Number(m[2]) - 1] : undefined;
  return m && bulan ? { d: m[3], m: bulan, y: m[1] } : null;
}

/** "02 Nov – 31 Des 2026" — selalu satu baris. Nilai yang tak dikenali ditampilkan apa adanya. */
export function formatRentangTanggal(from: string | null, until: string | null): string {
  if (!from && !until) return "Tanpa batas";
  const a = from ? bagian(from) : null, b = until ? bagian(until) : null;
  const teks = (iso: string, x: ReturnType<typeof bagian>) => (x ? `${x.d} ${x.m} ${x.y}` : iso);
  if (from && !until) return `mulai ${teks(from, a)}`;
  if (!from && until) return `s/d ${teks(until, b)}`;
  if (from === until) return teks(from!, a);
  if (a && b) return a.y === b.y ? `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}` : `${teks(from!, a)} – ${teks(until!, b)}`;
  return `${teks(from!, a)} – ${teks(until!, b)}`;
}
