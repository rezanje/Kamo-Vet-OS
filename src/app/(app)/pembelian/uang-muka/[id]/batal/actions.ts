"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** P08: OWNER cancels a used advance with every payment that used it, in one database transaction. */
export async function batalkanUangMukaBeserta(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("advance_id") ?? "").trim();
  const back = `/pembelian/uang-muka/${encodeURIComponent(id)}/batal`;
  const fail = (message: string): never => redirect(`${back}?error=${encodeURIComponent(message)}`);
  const requestKey = String(formData.get("request_key") ?? "").trim();
  const reason = String(formData.get("alasan") ?? "").trim();
  const fingerprint = String(formData.get("fingerprint") ?? "").trim();
  if (!id || !requestKey || requestKey.length > 120 || !fingerprint) fail("Formulir pembatalan tidak lengkap. Muat ulang halaman.");
  if (reason.length < 3 || reason.length > 1000) fail("Alasan pembatalan wajib diisi (3 sampai 1.000 karakter).");
  if (formData.get("setuju") !== "1") fail("Centang konfirmasi setelah memeriksa daftar pembayaran yang akan dibalik.");
  const { data, error } = await supabase.rpc("cancel_purchase_advance_cascade", {
    p_advance_id: id, p_reason: reason, p_request_key: requestKey, p_expected_fingerprint: fingerprint,
  });
  if (error) fail(error.message);
  if (!data?.advance_id || !data?.journal_id || data.advance_id !== id) throw new Error("Pembatalan belum terkonfirmasi lengkap. Periksa daftar uang muka sebelum mengulang.");
  for (const path of ["/pembelian/uang-muka", "/keuangan/hutang", "/pembelian/faktur", "/pembelian/perintah-bayar", "/laporan/pembelian", "/"]) revalidatePath(path);
  const count = Number(data.payment_count ?? 0);
  redirect(`/pembelian/uang-muka?success=${encodeURIComponent(`Uang muka ${data.no_um} dibatalkan${count ? ` bersama ${count} pembayaran yang memakainya` : ""}.`)}`);
}
