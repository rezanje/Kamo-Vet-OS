"use server";
// F2 (meeting 12 Nov 2026): bebankan selisih kurang opname ke karyawan sebagai kasbon (tidak potong gaji).
// Semua aturan diperiksa ulang di database (charge_opname_variance_to_employees / cancel_opname_variance_charge).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bacaIsianBeban, bacaRupiah, kunciSah, pesanBebanKaryawan, rupiah, ALASAN_BEBAN_MAKS, ALASAN_BEBAN_MIN } from "@/lib/beban-selisih-karyawan";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function kembali(orderId: string, hasil: { success?: string; error?: string }): never {
  const q = new URLSearchParams(hasil as Record<string, string>);
  redirect(`/pos/opname/${encodeURIComponent(orderId)}?${q.toString()}#beban-karyawan`);
}

export async function catatBebanKaryawan(formData: FormData) {
  const orderId = String(formData.get("order_id") ?? "");
  const resultId = String(formData.get("result_id") ?? "");
  const key = formData.get("request_key");
  if (!UUID.test(orderId)) redirect("/pos/opname");
  if (!UUID.test(resultId)) kembali(orderId, { error: "Hasil opname tidak valid. Muat ulang halaman." });
  if (!kunciSah(key)) kembali(orderId, { error: "Muat ulang halaman lalu coba lagi." });
  const total = bacaRupiah(String(formData.get("total") ?? ""));
  if (total === null || total <= 0) kembali(orderId, { error: "Nilai beban tidak valid. Muat ulang halaman." });
  const isian = bacaIsianBeban({ baris: formData.get("baris"), alasan: formData.get("alasan") }, total!);
  if (!isian.ok) kembali(orderId, { error: isian.pesan });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("charge_opname_variance_to_employees", {
    p_result_id: resultId,
    p_lines: isian.isian.baris,
    p_reason: isian.isian.alasan,
    p_request_key: key,
  });
  if (error || !data) kembali(orderId, { error: pesanBebanKaryawan(error) });
  revalidatePath(`/pos/opname/${orderId}`);
  revalidatePath("/hris/pengajuan");
  const nilai = Number((data as { total?: unknown }).total);
  kembali(orderId, { success: `Beban ${rupiah(Number.isFinite(nilai) ? nilai : total!)} dicatat sebagai kasbon karyawan (tidak dipotong gaji otomatis).` });
}

export async function batalBebanKaryawan(formData: FormData) {
  const orderId = String(formData.get("order_id") ?? "");
  const chargeId = String(formData.get("charge_id") ?? "");
  const key = formData.get("request_key");
  if (!UUID.test(orderId)) redirect("/pos/opname");
  if (!UUID.test(chargeId) || !kunciSah(key)) kembali(orderId, { error: "Muat ulang halaman lalu coba lagi." });
  const alasan = String(formData.get("alasan") ?? "").trim().replace(/\s+/g, " ");
  if (alasan.length < ALASAN_BEBAN_MIN || alasan.length > ALASAN_BEBAN_MAKS) kembali(orderId, { error: `Alasan pembatalan wajib diisi ${ALASAN_BEBAN_MIN}–${ALASAN_BEBAN_MAKS} huruf.` });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_opname_variance_charge", { p_charge_id: chargeId, p_reason: alasan, p_request_key: key });
  if (error || !data) kembali(orderId, { error: pesanBebanKaryawan(error) });
  revalidatePath(`/pos/opname/${orderId}`);
  revalidatePath("/hris/pengajuan");
  kembali(orderId, { success: "Beban karyawan dibatalkan. Kasbonnya ditandai batal dan jurnalnya sudah dibalik." });
}
