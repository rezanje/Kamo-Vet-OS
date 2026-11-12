"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";
import { pesanBatalPenerimaan, PESAN_BELUM_TERKONFIRMASI, ringkasanPratinjau, type HasilBatal, type PratinjauBatal } from "@/lib/batal-penerimaan-pesan";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tanggalIso = /^\d{4}-\d{2}-\d{2}$/;
export type HasilAksiBatal = { ok: true; hasil: HasilBatal } | { ok: false; pesan: string };
export type HasilPratinjauTanggal = { ok: true; ringkasan: string[]; tolakTanggal: string | null; minTanggal: string | null } | { ok: false; pesan: string };

/**
 * "Batalkan penerimaan" (Owner, atau peran yang diberi izin eksplisit): satu RPC atomik yang membalik uang yang sudah diterima pada satu
 * tagihan, mengembalikannya ke Belum Lunas dengan nomor yang sama, dan mencatat jejak. Idempoten menurut kunci: respons yang hilang aman
 * diulang dengan kunci yang sama. Otorisasi sebenarnya ada di database; layar hanya menyembunyikan tombolnya.
 *
 * Tanggal efektif (backdate): kosong atau hari ini = perilaku lama (pembukuan hari ini). Tanggal lain dikirim apa adanya; database memutuskan
 * (hanya Owner/izin tertulis, tidak sebelum tanggal penerimaan asli, tidak masa depan, periode tidak tertutup).
 */
export async function batalkanPenerimaanKlinik(form: FormData): Promise<HasilAksiBatal> {
  const invoiceId = String(form.get("invoice_id") ?? "").trim();
  const visitId = String(form.get("visit_id") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();
  const key = String(form.get("request_key") ?? "").trim();
  const efektif = String(form.get("effective_date") ?? "").trim();
  if (!uuid.test(invoiceId) || !uuid.test(visitId)) return { ok: false, pesan: "Tagihan tidak valid. Muat ulang halaman." };
  if (reason.replace(/\s/g, "").length < 3 || reason.length > 500) return { ok: false, pesan: pesanBatalPenerimaan("RECEIPT_INVALID: x") };
  if (!key || key.length > 100) return { ok: false, pesan: "Identitas simpan belum siap. Muat ulang halaman." };
  if (efektif && !tanggalIso.test(efektif)) return { ok: false, pesan: "Tanggal tidak valid. Pilih dari kalender." };
  const db = await createClient();
  const args: Record<string, unknown> = { p_invoice_id: invoiceId, p_request_key: key, p_reason: reason };
  // Hari ini = tanpa tanggal (sidik permintaan sama persis dengan versi lama); selain itu dikirim dan diputuskan database.
  if (efektif && efektif !== hariIniWIB()) args.p_effective_date = efektif;
  const { data, error } = await db.rpc("clinic_cancel_invoice_receipt", args);
  if (error) return { ok: false, pesan: pesanBatalPenerimaan(error.message) };
  if (!data || data.status !== "CANCELLED" || data.invoice_id !== invoiceId) return { ok: false, pesan: PESAN_BELUM_TERKONFIRMASI };
  revalidatePath("/", "layout");
  return { ok: true, hasil: data as HasilBatal };
}

/** Pratinjau baca-saja untuk tanggal yang dipilih: ringkasan efek + alasan tanggal ditolak (periode, batas, hak) sebelum Owner menekan batalkan. */
export async function pratinjauTanggalBatalPenerimaan(invoiceId: string, tanggal: string): Promise<HasilPratinjauTanggal> {
  if (!uuid.test(invoiceId)) return { ok: false, pesan: "Tagihan tidak valid. Muat ulang halaman." };
  if (tanggal && !tanggalIso.test(tanggal)) return { ok: false, pesan: "Tanggal tidak valid. Pilih dari kalender." };
  const db = await createClient();
  const args: Record<string, unknown> = { p_invoice_id: invoiceId };
  if (tanggal && tanggal !== hariIniWIB()) args.p_effective_date = tanggal;
  const { data, error } = await db.rpc("clinic_cancel_invoice_receipt_preview", args);
  if (error || !data) return { ok: false, pesan: pesanBatalPenerimaan(error?.message) };
  const p = data as PratinjauBatal;
  if (p.refuse) return { ok: false, pesan: p.refuse.message };
  return { ok: true, ringkasan: ringkasanPratinjau(p, tanggal || p.today), tolakTanggal: p.date_refuse?.message ?? null, minTanggal: p.min_date ?? null };
}

/** Owner mengembalikan tanggal pembukuan sebuah tagihan ke hari ini: koreksi dan penerimaan ulang berikutnya kembali dibukukan pada hari ini. */
export async function lepasTanggalEfektif(form: FormData): Promise<void> {
  const invoiceId = String(form.get("invoice_id") ?? "").trim();
  const visitId = String(form.get("visit_id") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();
  const kembali = uuid.test(visitId) ? `/klinik/pembayaran/${visitId}${uuid.test(invoiceId) ? `?invoice_id=${invoiceId}` : ""}` : "/klinik/antrian";
  const sambung = kembali.includes("?") ? "&" : "?";
  if (!uuid.test(invoiceId)) redirect(`${kembali}${sambung}error=${encodeURIComponent("Tagihan tidak valid. Muat ulang halaman.")}`);
  if (reason.replace(/\s/g, "").length < 3 || reason.length > 500) redirect(`${kembali}${sambung}error=${encodeURIComponent("Alasan wajib diisi (3 sampai 500 huruf).")}`);
  const db = await createClient();
  const { error } = await db.rpc("clinic_backdate_release", { p_invoice_id: invoiceId, p_reason: reason });
  if (error) redirect(`${kembali}${sambung}error=${encodeURIComponent(pesanBatalPenerimaan(error.message))}`);
  revalidatePath("/", "layout");
  redirect(`${kembali}${sambung}success=${encodeURIComponent("Tanggal pembukuan kembali ke hari ini.")}`);
}
