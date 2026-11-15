"use server";

import { createClient } from "@/lib/supabase/server";
import { adalahTab } from "@/lib/marketing-followup";
import { catatDihubungi, periksaAksesMarketing, type CatatHasil, type CatatInput } from "@/lib/marketing-followup-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Catat "Sudah dihubungi". Gerbang dua lapis: akses halaman di sini, lalu izin + cabang di fungsi database. Tidak mengirim pesan apa pun. */
export async function catatDihubungiAksi(input: CatatInput): Promise<CatatHasil> {
  const i = (input ?? {}) as Partial<CatatInput>;
  if (!i.customerId || !UUID.test(i.customerId) || (i.petId != null && !UUID.test(i.petId)) || (i.cabangId != null && !UUID.test(i.cabangId))
      || !adalahTab(i.tab) || typeof i.hasil !== "string" || typeof i.catatan !== "string" || !i.kunci || !UUID.test(i.kunci)) {
    return { ok: false, pesan: "Data tidak lengkap. Muat ulang halaman lalu coba lagi." };
  }
  const supabase = await createClient();
  const akses = await periksaAksesMarketing(supabase);
  if (!akses.ok) return { ok: false, pesan: "Akun Anda belum diberi akses Follow up pelanggan. Minta Owner mencentangnya di Akses Grup." };
  return catatDihubungi(supabase, { customerId: i.customerId, petId: i.petId ?? null, tab: i.tab, cabangId: i.cabangId ?? null, hasil: i.hasil, catatan: i.catatan.slice(0, 2000), kunci: i.kunci });
}
