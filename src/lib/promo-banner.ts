// Banner "Promo diterapkan" di kasir: angka yang ditampilkan harus sama dengan potongan yang benar-benar masuk total.
// Mesin promo menghitung potongan promo per baris, tetapi diskon barang di baris itu (diskon bawaan master barang atau ketikan
// kasir) MENANG dan tidak ditumpuk (lib/pos-calc.lineDiscount). Tanpa pemisahan ini banner mengiklankan "hemat" yang tidak dipotong.
// Hanya tampilan: tidak mengubah harga/potongan/penyimpanan.
import { lineDiscount, manualDiscount, type CartLine } from "./pos-calc";

export type PromoBannerApplied = { promo_id: string; name: string | null; discount: number; kind: "syarat_hasil" | "legacy" };
export type PromoBannerRow = CartLine & { nama?: string; promo_id?: string | null; promo_discount?: number | null; sh_claim?: unknown };

export type PromoDipakai = { promo_id: string; name: string | null; discount: number };
export type PromoTertimpa = {
  promo_id: string; name: string | null;
  /** Potongan yang dihitung mesin promo tetapi TIDAK masuk total (kalah dari diskon barang). */
  promoDiscount: number;
  /** Diskon barang yang dipakai sebagai gantinya di baris yang sama. */
  itemDiscount: number;
  /** Mis. "20%" atau "Rp5.000" (satu nilai bila semua baris sama, kalau beda digabung). */
  itemDiscountLabel: string;
  barang: string[];
};

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const labelDiskon = (l: PromoBannerRow) => l.item_discount_type === "percent" ? `${Number(l.item_discount_value) || 0}%` : rp(manualDiscount(l));

export function ringkasBannerPromo(applied: readonly PromoBannerApplied[], rows: readonly PromoBannerRow[]): { dipakai: PromoDipakai[]; tertimpa: PromoTertimpa[] } {
  const dipakai: PromoDipakai[] = [], tertimpa: PromoTertimpa[] = [];
  for (const a of applied) {
    if (a.kind !== "legacy") { dipakai.push({ promo_id: a.promo_id, name: a.name, discount: a.discount }); continue; }
    const kalah = rows.filter((r) => r.promo_id === a.promo_id && !r.sh_claim && (Number(r.promo_discount) || 0) > 0 && manualDiscount(r) > 0);
    const hilang = kalah.reduce((s, r) => s + Math.min(Number(r.promo_discount) || 0, r.qty * r.harga), 0);
    const nyata = Math.max(0, a.discount - hilang);
    if (nyata > 0) dipakai.push({ promo_id: a.promo_id, name: a.name, discount: nyata });
    if (kalah.length > 0) {
      const labels = [...new Set(kalah.map(labelDiskon))];
      tertimpa.push({
        promo_id: a.promo_id, name: a.name, promoDiscount: hilang,
        itemDiscount: kalah.reduce((s, r) => s + lineDiscount(r), 0), itemDiscountLabel: labels.join(" / "),
        barang: [...new Set(kalah.map((r) => r.nama ?? "barang"))],
      });
    }
  }
  return { dipakai, tertimpa };
}
