import { hariIniWIB } from "@/lib/tanggal";

/**
 * Tanggal efektif (mundur) untuk pembatalan pembelian dan dokumen penggantinya (penerimaan, faktur, pembayaran, uang muka).
 *
 * Aturan (ditegakkan database di purchase_effective_date_check; layar hanya membantu memilih):
 *  - bawaan hari ini; rentang tanggal dokumen asal .. hari ini; tidak boleh masa depan;
 *  - tanggal SEBELUM hari ini hanya untuk Owner aktif atau peran yang diberi izin "Tanggal mundur" di Akses Grup (bawaan mati);
 *  - alasan wajib bila mundur; periode akuntansi / Closing HPP yang ditutup menolak dengan penjelasan.
 */
export const PURCHASE_BACKDATE_ACTION = "pembelian.tanggal_mundur";

type AccessClient = { rpc(name: "get_my_purchase_backdate_access"): PromiseLike<{ data: unknown; error: unknown }> };
type ProfileLike = { role?: string | null; is_active?: boolean | null } | null | undefined;

/** Owner aktif SELALU boleh dan tidak membaca kebijakan (gagal-terbuka khusus Owner); peran lain gagal-tertutup. */
export async function loadPurchaseBackdateAccess(client: AccessClient, profile: ProfileLike): Promise<boolean> {
  if (!!profile && profile.is_active === true && profile.role === "OWNER") return true;
  if (!profile || profile.is_active !== true) return false;
  try {
    const { data, error } = await client.rpc("get_my_purchase_backdate_access");
    return !error && data === true;
  } catch {
    return false;
  }
}

export type EffectiveDateBounds = { value: string; min: string; max: string; locked: boolean };

const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Batas isian tanggal: bawaan hari ini; Owner/izin bisa mundur sampai tanggal dokumen asal; tanpa izin dikunci ke hari ini. */
export function effectiveDateBounds({ docDate, canBackdate, today = hariIniWIB() }: { docDate?: string | null; canBackdate: boolean; today?: string }): EffectiveDateBounds {
  const floor = isIsoDate(docDate) && docDate <= today ? docDate : today;
  return canBackdate ? { value: today, min: floor, max: today, locked: false } : { value: today, min: today, max: today, locked: true };
}

export type EffectiveDateResult = { ok: true; value: string } | { ok: false; message: string };

/** Pemeriksaan sisi server sebelum RPC: tanggal sah dan tidak di masa depan (izin, tanggal dokumen asal, periode: database). Kosong = hari ini. */
export function readEffectiveDate(raw: unknown, today = hariIniWIB()): EffectiveDateResult {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, value: today };
  if (!isIsoDate(text)) return { ok: false, message: "Tanggal tidak valid. Pilih tanggal dari kalender." };
  if (text > today) return { ok: false, message: `Tanggal tidak boleh di masa depan (hari ini ${today}). Pilih hari ini atau sebelumnya.` };
  return { ok: true, value: text };
}
