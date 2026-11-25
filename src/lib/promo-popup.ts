// Tampilan daftar "Promo Berjalan Hari Ini" di kasir (hanya tampilan; tidak menghitung uang).
export type PromoPopupRow = {
  id: string;
  name: string;
  promo_type?: string | null;
  rule?: { suggest?: string; discount_mode?: unknown; syarat_hasil?: unknown; discount_type?: string; discount_value?: number } | null;
  valid_from?: string | null;
  valid_until?: string | null;
  branch_ids?: string[] | null;
  min_qty?: number | string | null;
  kelipatan?: boolean | null;
  discount_type?: string | null;
  discount_value?: number | string | null;
};

export type PromoChip = { label: string; tone: "paket" | "persen" | "rupiah" | "gratis" | "bundling" | "lain" };

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const num = (v: unknown): number | null => { const n = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n; };

/** "2026-11-03" -> "3 Nov 2026"; tanggal tidak valid dikembalikan apa adanya. */
export function tanggalPendek(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return iso ?? "";
  const bulan = BULAN[Number(m[2]) - 1];
  return bulan ? `${Number(m[3])} ${bulan} ${m[1]}` : (iso ?? "");
}

export function promoChip(p: PromoPopupRow): PromoChip {
  const mode = p.rule?.discount_mode;
  if (p.promo_type === "bundling" || mode === "syarat_hasil" || p.rule?.syarat_hasil) return { label: "Bundling", tone: "bundling" };
  if (mode === "package_total" || mode === "quantity_pool") return { label: "Harga paket", tone: "paket" };
  const tipe = p.discount_type ?? p.rule?.discount_type ?? null;
  const nilai = num(p.discount_value ?? p.rule?.discount_value);
  if (tipe === "percent") return nilai !== null && nilai >= 100 ? { label: "Gratis", tone: "gratis" } : { label: "Potongan %", tone: "persen" };
  if (tipe === "nominal") return { label: "Potongan Rp", tone: "rupiah" };
  return { label: "Promo", tone: "lain" };
}

/** Satu baris ringkas aturan: teks dari pusat bila ada, kalau tidak dirangkai dari data promo. */
export function promoAturan(p: PromoPopupRow): string {
  const saran = p.rule?.suggest?.trim();
  if (saran) return saran;
  const tipe = p.discount_type ?? p.rule?.discount_type ?? null;
  const nilai = num(p.discount_value ?? p.rule?.discount_value);
  const bagian: string[] = [];
  if (nilai !== null && nilai > 0 && tipe === "percent") bagian.push(`Diskon ${nilai}%`);
  else if (nilai !== null && nilai > 0 && tipe === "nominal") bagian.push(`Potongan ${rp(nilai)}`);
  const min = num(p.min_qty);
  if (min !== null && min > 1) bagian.push(`min. ${min} pcs${p.kelipatan ? ", berlaku kelipatan" : ""}`);
  return bagian.join(" · ");
}

export function promoBerlaku(p: PromoPopupRow): string {
  return `Berlaku ${p.valid_from ? tanggalPendek(p.valid_from) : "—"} s/d ${p.valid_until ? tanggalPendek(p.valid_until) : "tanpa batas"}`;
}

export function promoCabang(p: PromoPopupRow): string | null {
  const n = p.branch_ids?.length ?? 0;
  return n === 0 ? null : n === 1 ? "Khusus cabang ini" : `${n} cabang`;
}

export const AMBANG_CARI_PROMO = 8;

export function cariPromo<T extends PromoPopupRow>(promos: readonly T[], kata: string): T[] {
  const k = kata.trim().toLowerCase();
  if (!k) return [...promos];
  return promos.filter((p) => `${p.name} ${promoAturan(p)} ${promoChip(p).label}`.toLowerCase().includes(k));
}
