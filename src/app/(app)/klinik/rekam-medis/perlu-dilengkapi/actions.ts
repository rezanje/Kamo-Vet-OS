"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bolehKelolaKartuTertunda, isianLengkapi, pesanPetugas } from "@/lib/kartu-tertunda";

const DASAR = "/klinik/rekam-medis/perlu-dilengkapi";
const kembali = (id: string, pesan: string, extra: Record<string, string> = {}) =>
  `${DASAR}/${encodeURIComponent(id)}?${new URLSearchParams({ ...extra, error: pesan })}`;

async function petugas() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let boleh = false;
  try { boleh = await bolehKelolaKartuTertunda(supabase, user?.id); } catch { boleh = false; }
  return { supabase, boleh };
}

/** Lengkapi satu kartu lalu pindahkan ke riwayat resmi (satu transaksi di database). */
export async function lengkapiKartuTertunda(form: FormData) {
  const id = String(form.get("id") ?? "");
  const hp = String(form.get("phone") ?? "").trim();
  const isian = isianLengkapi(form);
  if (!isian.ok) redirect(kembali(id, isian.pesan, hp ? { hp } : {}));
  const { supabase, boleh } = await petugas();
  if (!boleh) redirect(kembali(id, "Hanya OWNER/ADMIN aktif yang boleh melengkapi kartu."));
  const { data, error } = await supabase.rpc("lengkapi_kartu_tertunda", isian.isian);
  if (error || typeof data !== "string") redirect(kembali(id, pesanPetugas(error?.message), hp ? { hp } : {}));
  revalidatePath(DASAR);
  revalidatePath("/klinik/rekam-medis");
  redirect(`${DASAR}?${new URLSearchParams({ ok: "Kartu sudah masuk ke riwayat pasien." })}`);
}

/** Batalkan kartu (mis. salinan identik). Wajib alasan; kartu tidak dihapus. */
export async function batalkanKartuTertunda(form: FormData) {
  const id = String(form.get("id") ?? "");
  const alasan = String(form.get("alasan") ?? "").trim();
  if (!alasan) redirect(kembali(id, "Alasan pembatalan wajib diisi."));
  if ([...alasan].length > 500) redirect(kembali(id, "Alasan maksimal 500 karakter."));
  const { supabase, boleh } = await petugas();
  if (!boleh) redirect(kembali(id, "Hanya OWNER/ADMIN aktif yang boleh membatalkan kartu."));
  const { error } = await supabase.rpc("batalkan_kartu_tertunda", { p_id: id, p_alasan: alasan });
  if (error) redirect(kembali(id, pesanPetugas(error.message)));
  revalidatePath(DASAR);
  redirect(`${DASAR}?${new URLSearchParams({ ok: "Kartu dibatalkan (tetap tersimpan sebagai arsip)." })}`);
}
