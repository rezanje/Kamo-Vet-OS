"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Simpan Mode PKP + tarif PPN. Berlaku ke transaksi BARU saja (data lama tidak diubah).
export async function simpanPajak(formData: FormData) {
  const supabase = await createClient();
  const mode_pkp = String(formData.get("mode_pkp") ?? "") === "on";
  const ppn_rate = Number(formData.get("ppn_rate")) || 11;
  const back = "/pengaturan/pajak";

  if (ppn_rate <= 0 || ppn_rate > 50) redirect(`${back}?error=${encodeURIComponent("Tarif PPN tidak wajar.")}`);

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("company_settings")
    .update({ mode_pkp, ppn_rate, updated_by: user?.id ?? null, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(back);
  redirect(`${back}?success=${encodeURIComponent(mode_pkp ? `Mode PKP AKTIF — PPN ${ppn_rate}% mulai berlaku di transaksi baru.` : "Mode PKP nonaktif — transaksi baru tanpa PPN.")}`);
}
