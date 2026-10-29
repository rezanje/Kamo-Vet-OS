"use server";
// Pakai deposit rawat inap pada tagihan yang SUDAH tersimpan.
//
// Jalur normal memotong deposit otomatis saat tagihan pulang dibuat. Tombol ini
// untuk sisanya: tagihan yang di-void lalu diterbitkan ulang mengembalikan
// deposit ke saldo pemilik, jadi tagihan penggantinya perlu dipotong lagi —
// tanpa ini pemilik tampak berutang padahal uangnya sudah dititipkan.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cekPeriode } from "@/lib/jurnal-guard";
import { hariIniWIB } from "@/lib/tanggal";
import { pesanErrorDeposit } from "@/lib/deposit-ranap";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function pakaiDepositTagihan(formData: FormData) {
  const visitId = String(formData.get("visitId") ?? "").trim();
  const back = `/klinik/pembayaran/${uuid.test(visitId) ? visitId : ""}`;
  const gagal = (pesan: string): never => redirect(`${back}?error=${encodeURIComponent(pesan)}`);
  const invoiceId = String(formData.get("invoice_id") ?? "").trim();
  const requestKey = String(formData.get("request_key") ?? "").trim();
  if (!uuid.test(visitId) || !uuid.test(invoiceId) || !requestKey) {
    gagal("Tagihan tidak dikenali. Muat ulang halaman lalu coba lagi.");
  }

  const supabase = await createClient();
  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) gagal(pesanPeriode);

  const { data, error } = await supabase.rpc("clinic_apply_inpatient_deposit", {
    p_invoice_id: invoiceId, p_request_key: requestKey,
  });
  if (error) gagal(pesanErrorDeposit(error));
  if (!Number(data)) gagal("Tidak ada saldo deposit yang bisa dipakai pada tagihan ini.");
  revalidatePath(back);
  redirect(`${back}?success=deposit`);
}
