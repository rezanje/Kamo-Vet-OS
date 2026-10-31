"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { cekPeriode } from "@/lib/jurnal-guard";
import { hariIniWIB } from "@/lib/tanggal";
import { parseBagianPelunasan, pesanPelunasanGagal, totalBagian, type BagianPelunasan } from "@/lib/pelunasan-klinik";

/**
 * Pelunasan tagihan rawat jalan DP/Belum Lunas oleh kasir klinik yang berwenang.
 * Uang masuk laci shift klinik kasir sendiri lewat writer kwitansi asli, pada invoice
 * yang sama; basis data memeriksa ulang akses, laci, rekening, periode dan sisa di bawah
 * kunci koordinator. Tidak ada invoice pengganti dan stok/HPP tidak disentuh.
 */
export async function lunasiTagihanKlinik(formData: FormData) {
  const visitId = String(formData.get("visitId") ?? "").trim();
  if (!visitId) redirect(`/klinik/antrian?error=${encodeURIComponent("Kunjungan tidak valid")}`);
  const back = `/klinik/pembayaran/${visitId}`;
  const gagal = (pesan: string): never => redirect(`${back}?error=${encodeURIComponent(pesan)}`);

  const invoiceId = String(formData.get("invoice_id") ?? "").trim();
  const requestKey = String(formData.get("request_key") ?? "").trim();
  const expectedRaw = String(formData.get("expected_remaining") ?? "").trim();
  const expected = Number(expectedRaw);
  if (!invoiceId || !requestKey || requestKey.length > 100 || !expectedRaw || !Number.isSafeInteger(expected) || expected <= 0) {
    gagal("Data pelunasan tidak lengkap. Muat ulang halaman; belum ada uang yang tersimpan.");
  }
  let parts: BagianPelunasan[] = [];
  try { parts = parseBagianPelunasan(String(formData.get("parts") ?? "")); }
  catch (error) { gagal(error instanceof Error ? error.message : "Rincian pembayaran tidak valid."); }
  if (totalBagian(parts) > expected) gagal("Nominal pelunasan melebihi sisa tagihan. Tidak ada uang yang tersimpan.");

  const supabase = await createClient();
  // Uang klinik hanya berpindah di dalam shift klinik milik kasirnya (diperiksa ulang di DB).
  const { data: { user } } = await supabase.auth.getUser();
  const shift = user ? await getOpenShift(supabase as never, user.id, "klinik") : null;
  if (!shift) redirect(`/klinik/shift?error=${encodeURIComponent("Mulai shift klinik dulu sebelum menerima pelunasan")}`);
  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) gagal(pesanPeriode);

  const { error } = await supabase.rpc("clinic_settle_outpatient_invoice", {
    p_visit_id: visitId, p_invoice_id: invoiceId, p_request_key: requestKey,
    p_parts: parts, p_expected_remaining: expected,
  });
  if (error) gagal(pesanPelunasanGagal(error));

  for (const path of [back, "/klinik/antrian", "/keuangan/piutang"]) revalidatePath(path);
  redirect(`${back}?success=bayar`);
}
