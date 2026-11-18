/**
 * Input penjualan petshop dengan TANGGAL MUNDUR (kasir /kasir dan POS belakang /pos/transaksi).
 *
 * Kasus Andri (18 Nov 2026): barang yang terlupa harus masuk penjualan kemarin. Aturan (ditegakkan database; layar hanya membantu):
 *  - tanggal struk = tanggal pembukuan (omzet, jurnal penjualan, komisi); stok dan HPP tetap HARI INI; uang fisik ke shift yang terbuka sekarang;
 *  - hanya Owner, atau peran yang dicentang Owner pada izin "Tanggal mundur" (Akses Grup, bawaan mati);
 *  - alasan wajib; paling lama 31 hari ke belakang; periode tertutup / bulan sudah digaji / rekonsiliasi bank ditolak database;
 *  - tanpa voucher, kode kampanye, poin, dan promo; harga = harga master sekarang.
 *
 * Fungsi murni + dua pemanggil RPC. Database tetap pemutus (pos_sale_backdate_authorize + gerbang INSERT sales).
 */
import { hariIniWIB } from "./tanggal";
import { tanggalId, tanggalIsoValid, tanggalWibDariWaktu } from "./tanggal-efektif-petshop";

export const TANGGAL_MUNDUR_MAKS_HARI = 31;
export const TANGGAL_MUNDUR_FIELD = "tanggal_pembukuan";
export const ALASAN_MUNDUR_FIELD = "alasan_tanggal";

export const LABEL_TANGGAL_PEMBUKUAN = "Ubah tanggal pembukuan (opsional)";
export const CATATAN_TANGGAL_MUNDUR = "Struk dicatat di tanggal ini (omzet dan jurnal penjualan). Stok dan HPP tetap hari ini; uang fisik masuk shift yang sedang terbuka. Harga memakai harga master hari ini; tanpa promo, voucher, atau poin.";
export const LABEL_ALASAN_TANGGAL = "Alasan mencatat di tanggal lain *";

export const PESAN_MUNDUR_TANPA_VOUCHER = "Voucher dan kode kampanye tidak berlaku pada transaksi tanggal mundur. Kosongkan kodenya, atau catat dengan tanggal hari ini.";
export const PESAN_MUNDUR_TANPA_POIN = "Poin tidak dipakai atau didapat pada transaksi tanggal mundur. Kosongkan poin yang dipakai, atau catat dengan tanggal hari ini.";
export const PESAN_MUNDUR_TANPA_PROMO = "Ada promo yang berlaku pada barang di keranjang. Promo tidak dihitung pada transaksi tanggal mundur: pilih \"Tanpa promo\" bila layar menyediakannya, keluarkan barang yang sedang promo, atau catat dengan tanggal hari ini.";
export const PESAN_MUNDUR_TANPA_PENGGANTI = "Transaksi pengganti (Ubah transaksi) tidak bisa memakai tanggal mundur. Tanggal pengganti mengikuti struk aslinya.";

export type TanggalMundur = { tanggal: string; alasan: string };
export type HasilBacaMundur = { ok: true; value: TanggalMundur | null } | { ok: false; message: string };

/** Mundur satu hari lebih dari batas: "YYYY-MM-DD" -> hari ke belakang (UTC murni, tanpa zona). */
function selisihHari(dari: string, ke: string): number {
  return Math.round((Date.parse(`${ke}T00:00:00Z`) - Date.parse(`${dari}T00:00:00Z`)) / 86_400_000);
}

/**
 * Isian formulir: kosong atau sama dengan hari ini = jalur biasa (null). Tanggal tidak valid / masa depan / lebih dari 31 hari / tanpa alasan = galat jelas
 * (bukan diam-diam hari ini). Izin, periode tertutup, bulan digaji, dan bank diputuskan database.
 */
export function bacaTanggalMundurJual(form: FormData, hariIni: string = hariIniWIB()): HasilBacaMundur {
  const text = String(form.get(TANGGAL_MUNDUR_FIELD) ?? "").trim();
  if (!text || text === hariIni) return { ok: true, value: null };
  if (!tanggalIsoValid(text)) return { ok: false, message: "Tanggal pembukuan tidak valid. Pilih tanggal dari kalender." };
  if (text > hariIni) return { ok: false, message: `Tanggal pembukuan ${tanggalId(text)} belum tiba (hari ini ${tanggalId(hariIni)}). Pilih hari ini atau tanggal sebelumnya.` };
  if (selisihHari(text, hariIni) > TANGGAL_MUNDUR_MAKS_HARI) {
    return { ok: false, message: `Tanggal pembukuan terlalu jauh ke belakang (paling lama ${TANGGAL_MUNDUR_MAKS_HARI} hari). Lebih lama dari itu perlu koreksi pembukuan, bukan input kasir.` };
  }
  const alasan = String(form.get(ALASAN_MUNDUR_FIELD) ?? "").trim();
  if (alasan.length < 3 || alasan.length > 200) return { ok: false, message: "Alasan mencatat di tanggal lain wajib diisi (3-200 huruf)." };
  return { ok: true, value: { tanggal: text, alasan } };
}

/** Tanggal struk di database: pukul 23:59 WIB hari itu (= pos_sale_backdate_stamp). */
export function cetakWaktuMundur(tanggal: string): string {
  return `${tanggal}T23:59:00+07:00`;
}

/** Kombinasi yang tidak dipakai bersama tanggal mundur; null = boleh. Promo dicek terpisah (setelah dihitung). */
export function tolakKombinasiMundur(o: { kodeMasuk?: string | null; poinDipakai?: number; pengganti?: boolean }): string | null {
  if (o.pengganti) return PESAN_MUNDUR_TANPA_PENGGANTI;
  if (o.kodeMasuk) return PESAN_MUNDUR_TANPA_VOUCHER;
  if ((o.poinDipakai ?? 0) > 0) return PESAN_MUNDUR_TANPA_POIN;
  return null;
}

/** Promo yang kena pada keranjang (potongan promo, klaim syarat-hasil, atau baris promo) menolak tanggal mundur. */
export function promoKenaPadaKeranjang(o: { potonganPromo: readonly { potongan?: number }[]; adaKlaim?: boolean; hitCount?: number }): boolean {
  return o.potonganPromo.length > 0 || o.adaKlaim === true || (o.hitCount ?? 0) > 0;
}

type RpcClient = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };

/** Pesan database yang sudah berbahasa Indonesia dipakai apa adanya; galat teknis diganti kalimat aman. */
export function pesanGalatMundur(message: string | undefined | null): string {
  const m = String(message ?? "").trim();
  if (!m || /^(permission denied|new row|violates|duplicate key|could not|function public\.)/i.test(m) || m.length > 400) {
    return "Tanggal mundur belum dapat diizinkan. Coba lagi; bila berulang, hubungi Owner.";
  }
  return m;
}

/**
 * Minta izin-pakai database tepat sebelum INSERT struk. null = diizinkan; selain itu kalimat penolakan.
 * Kunci checkout yang sama + tanggal yang sama aman diulang (idempoten).
 */
export async function izinkanTanggalMundur(supabase: RpcClient, o: { branchId: string; checkoutKey: string; tanggal: string; alasan: string }): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("pos_sale_backdate_authorize", {
      p_branch: o.branchId, p_checkout_key: o.checkoutKey, p_date: o.tanggal, p_reason: o.alasan,
    });
    if (error) return pesanGalatMundur(error.message);
    return (data as { authorized?: boolean } | null)?.authorized === true ? null : "Tanggal mundur belum diizinkan database. Coba lagi.";
  } catch {
    // Galat jaringan/teknis dari klien: kalimat aman, bukan pesan mentah.
    return pesanGalatMundur(null);
  }
}

export type BatasMundurJual = { max: string; min: string; canBackdate: boolean };

/**
 * Batas pilihan tanggal untuk layar: Owner / peran berizin saja (can_backdate). Gagal baca = null = layar tidak menampilkan apa pun
 * (gagal-tertutup; database tetap memutuskan). min sudah memperhitungkan periode tertutup dan batas 31 hari.
 */
export async function bacaBatasMundurJual(supabase: RpcClient, branchId: string | null | undefined): Promise<BatasMundurJual | null> {
  if (!branchId) return null;
  try {
    const { data, error } = await supabase.rpc("pos_sale_backdate_bounds", { p_branch: branchId });
    if (error || !data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" && tanggalIsoValid(v) ? v : null);
    const max = s(d.max_date), min = s(d.effective_min);
    if (!max || !min || d.can_backdate !== true || min > max) return null;
    return { max, min, canBackdate: true };
  } catch {
    return null;
  }
}

/** Kalimat banner/struk: tanggal pembukuan + waktu nyata pencatatan. */
export function catatanStrukMundur(tanggalStruk: string | null | undefined, dicatatIso: string | null | undefined): string | null {
  if (!tanggalStruk || !dicatatIso) return null;
  const nyata = tanggalWibDariWaktu(dicatatIso);
  // Struk biasa selesai dalam hitungan detik; selisih kurang dari sejam (mis. lewat tengah malam) bukan tanggal mundur.
  if (!nyata || tanggalWibDariWaktu(tanggalStruk) === nyata || Date.parse(dicatatIso) - Date.parse(tanggalStruk) < 3_600_000) return null;
  const jam = new Date(Date.parse(dicatatIso) + 7 * 3600_000).toISOString().slice(11, 16);
  return `Dicatat tanggal real ${tanggalId(nyata)} ${jam} WIB`;
}

/** Banner di layar kasir saat tanggal dipilih. */
export function bannerTanggalMundur(tanggal: string, hariIni: string = hariIniWIB()): string {
  return `Struk ini dicatat di tanggal ${tanggalId(tanggal)} (dicatat hari ini ${tanggalId(hariIni)})`;
}
