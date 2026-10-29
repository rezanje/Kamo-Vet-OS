"use server";
// Deposit rawat inap: catat titipan, batalkan titipan yang belum terpakai, dan
// kembalikan sisanya. Semua penulisan uang dikerjakan satu RPC atomik di database
// (peran, cabang, shift klinik, nomor dokumen, dan jurnalnya dicek di sana).
// Server action ini hanya menyaring isian layar dan menerjemahkan errornya.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cekPeriode } from "@/lib/jurnal-guard";
import { hariIniWIB } from "@/lib/tanggal";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { periksaJumlahDeposit, pesanErrorDeposit } from "@/lib/deposit-ranap";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gagal(back: string, pesan: string): never {
  redirect(`${back}?error=${encodeURIComponent(pesan)}`);
}

export async function catatDeposit(formData: FormData) {
  const recordId = String(formData.get("recordId") ?? "").trim();
  const back = `/klinik/rawat-inap/${uuid.test(recordId) ? recordId : ""}`;
  if (!uuid.test(recordId)) gagal("/klinik/rawat-inap", "Data rawat inap tidak dikenali. Muat ulang halaman.");
  const requestKey = String(formData.get("request_key") ?? "").trim();
  if (!requestKey) gagal(back, "Kunci transaksi tidak valid. Muat ulang halaman lalu coba lagi.");

  const jumlah = Number(formData.get("jumlah"));
  const salah = periksaJumlahDeposit(formData.get("jumlah"));
  if (salah) gagal(back, salah);
  const metode = String(formData.get("metode") ?? "Tunai");
  if (!(METODE_BAYAR as readonly string[]).includes(metode)) gagal(back, "Pilih metode pembayaran yang tersedia.");
  const catatan = String(formData.get("catatan") ?? "").trim() || null;
  if ((catatan ?? "").length > 300) gagal(back, "Catatan deposit terlalu panjang (maksimal 300 karakter).");

  const supabase = await createClient();
  const tanggal = hariIniWIB();
  // Titipan menggerakkan kas dan utang; periode yang sudah ditutup tidak boleh diisi.
  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(back, pesanPeriode);

  const { data, error } = await supabase.rpc("clinic_record_inpatient_deposit", {
    p_record_id: recordId, p_request_key: requestKey, p_tanggal: tanggal,
    p_amount: jumlah, p_metode: metode, p_catatan: catatan,
  });
  if (error || !data) gagal(back, pesanErrorDeposit(error));
  revalidatePath(back);
  redirect(`${back}?success=deposit&deposit=${encodeURIComponent(String(data))}`);
}

export async function batalkanDeposit(formData: FormData) {
  const recordId = String(formData.get("recordId") ?? "").trim();
  const back = `/klinik/rawat-inap/${uuid.test(recordId) ? recordId : ""}`;
  if (!uuid.test(recordId)) gagal("/klinik/rawat-inap", "Data rawat inap tidak dikenali. Muat ulang halaman.");
  const depositId = String(formData.get("deposit_id") ?? "").trim();
  const requestKey = String(formData.get("request_key") ?? "").trim();
  const alasan = String(formData.get("alasan") ?? "").trim();
  if (!uuid.test(depositId) || !requestKey) gagal(back, "Pilih deposit yang benar lalu muat ulang halaman.");
  if (!alasan) gagal(back, "Isi alasan pembatalan deposit.");
  if (alasan.length > 500) gagal(back, "Alasan pembatalan terlalu panjang (maksimal 500 karakter).");

  const supabase = await createClient();
  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) gagal(back, pesanPeriode);
  const { error } = await supabase.rpc("clinic_cancel_inpatient_deposit", {
    p_deposit_id: depositId, p_request_key: requestKey, p_reason: alasan,
  });
  if (error) gagal(back, pesanErrorDeposit(error));
  revalidatePath(back);
  redirect(`${back}?success=depositbatal`);
}

export async function kembalikanDeposit(formData: FormData) {
  const recordId = String(formData.get("recordId") ?? "").trim();
  const back = `/klinik/rawat-inap/${uuid.test(recordId) ? recordId : ""}`;
  if (!uuid.test(recordId)) gagal("/klinik/rawat-inap", "Data rawat inap tidak dikenali. Muat ulang halaman.");
  const depositId = String(formData.get("deposit_id") ?? "").trim();
  const requestKey = String(formData.get("request_key") ?? "").trim();
  const alasan = String(formData.get("alasan") ?? "").trim();
  if (!uuid.test(depositId) || !requestKey) gagal(back, "Pilih deposit yang benar lalu muat ulang halaman.");
  if (!alasan) gagal(back, "Isi alasan pengembalian sisa deposit.");
  if (alasan.length > 500) gagal(back, "Alasan pengembalian terlalu panjang (maksimal 500 karakter).");

  const supabase = await createClient();
  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) gagal(back, pesanPeriode);
  const { error } = await supabase.rpc("clinic_refund_inpatient_deposit", {
    p_deposit_id: depositId, p_request_key: requestKey, p_reason: alasan,
  });
  if (error) gagal(back, pesanErrorDeposit(error));
  revalidatePath(back);
  redirect(`${back}?success=depositkembali`);
}
