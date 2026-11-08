// Rincian promo per barang di tagihan klinik (permintaan Reza, 8 Nov 2026):
// "setiap diskon produk ada informasi potongan rinciannya di struk, baris per produk
// (mis. promo Icarae MBC). Yang di bawah khusus diskon transaksi."
//
// Uangnya TIDAK diatur di sini — invoices.discount tetap satu-satunya angka potongan
// yang dibukukan. Modul ini hanya menyimpan & membaca catatan "promo X memotong
// barang Y sebesar Z" (tabel invoice_promo_lines) supaya struk bisa memindahkan
// potongan promo dari baris "Diskon" di bawah ke bawah baris barangnya.
//
// Semua kegagalan di sini jatuh ke tampilan lama (potongan digabung di bawah), tidak
// pernah menggagalkan pembayaran atau cetak struk.

import type { RincianPromoKlinik } from "./tagihan-klinik";
import { labelDiskonManual } from "./label-potongan";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type RincianPromoTersimpan = { invoice_id: string; item_id: string; promo_name: string; potongan: number };
export type PromoTercetak = { nama: string; potongan: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tabel belum terpasang (migrasi belum jalan): bukan galat, cukup tampilan lama. */
const tabelBelumAda = (error: { code?: string } | null | undefined) => error?.code === "42P01" || error?.code === "PGRST205";

/** Catat rincian promo invoice yang baru diposting. Aman diulang (baris sama dilewati database). */
export async function catatRincianPromoKlinik(supabase: AnyClient, invoiceId: string | null | undefined, rincian: readonly RincianPromoKlinik[] | undefined): Promise<void> {
  if (!invoiceId || !rincian?.length) return;
  const rows = rincian
    .filter((r) => UUID.test(r.item_id) && UUID.test(r.promo_id) && Number(r.potongan) > 0)
    .map((r) => ({
      invoice_id: invoiceId, item_id: r.item_id, promo_id: r.promo_id,
      promo_name: (r.promo_name || "Promo").trim().slice(0, 200) || "Promo",
      potongan: Math.round(Number(r.potongan) * 100) / 100,
    }));
  if (!rows.length) return;
  try {
    const { error } = await supabase.from("invoice_promo_lines").insert(rows);
    if (error && !tabelBelumAda(error)) console.error(`[rincian-promo] invoice ${invoiceId}: ${error.message}`);
  } catch (error) {
    console.error(`[rincian-promo] invoice ${invoiceId}: gagal dicatat`, error);
  }
}

/** Rincian promo beberapa invoice sekaligus. Gagal baca = peta kosong (struk memakai tampilan lama). */
export async function bacaRincianPromoKlinik(supabase: AnyClient, invoiceIds: readonly string[]): Promise<Map<string, RincianPromoTersimpan[]>> {
  const hasil = new Map<string, RincianPromoTersimpan[]>();
  const ids = [...new Set(invoiceIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (!ids.length) return hasil;
  try {
    const { data, error } = await supabase.from("invoice_promo_lines")
      .select("invoice_id, item_id, promo_name, potongan")
      .in("invoice_id", ids).order("created_at").order("id");
    if (error) {
      if (!tabelBelumAda(error)) console.error(`[rincian-promo] gagal dibaca: ${error.message}`);
      return hasil;
    }
    for (const row of (data ?? []) as RincianPromoTersimpan[]) {
      const potongan = Number(row.potongan);
      if (!Number.isFinite(potongan) || potongan <= 0) continue;
      hasil.set(row.invoice_id, [...(hasil.get(row.invoice_id) ?? []), { ...row, potongan }]);
    }
  } catch (error) {
    console.error("[rincian-promo] gagal dibaca", error);
  }
  return hasil;
}

/**
 * Tempelkan promo ke baris cetak yang memuat barangnya (baris paket: salah satu isinya).
 * Satu catatan promo menempel ke SATU baris saja (yang pertama cocok). Total yang
 * ditempel tidak pernah melebihi `batas` (diskon invoice) — catatan yang tidak punya
 * baris, atau melampaui batas (mis. invoice sudah dikoreksi), tetap ikut di "Diskon
 * transaksi" seperti dulu supaya angka struk selalu cocok dengan totalnya.
 */
export function pasangPromoKeBaris<L extends { sources: readonly { item_id?: string | null }[] }>(
  lines: readonly L[], promos: readonly Pick<RincianPromoTersimpan, "item_id" | "promo_name" | "potongan">[], batas: number,
): { perBaris: PromoTercetak[][]; totalPromo: number } {
  const perBaris: PromoTercetak[][] = lines.map(() => []);
  let sisa = Math.max(0, Number(batas) || 0);
  let totalPromo = 0;
  for (const promo of promos) {
    const potongan = Number(promo.potongan) || 0;
    if (potongan <= 0 || potongan > sisa + 0.005) continue;
    const at = lines.findIndex((line) => line.sources.some((s) => !!s.item_id && s.item_id === promo.item_id));
    if (at < 0) continue;
    perBaris[at].push({ nama: promo.promo_name, potongan });
    sisa -= potongan;
    totalPromo += potongan;
  }
  return { perBaris, totalPromo };
}

/** Label diskon kasir per baris klinik: persen bila seragam, "Diskon item" bila baris paket campuran. */
export function labelDiskonBaris(line: { diskon_persen: number | null; diskon: number }): string | null {
  if (!(line.diskon > 0.005)) return null;
  return labelDiskonManual(line.diskon_persen);
}
