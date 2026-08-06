"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Keputusan staf atas sebuah booking. Booking yang sudah jadi kunjungan tidak
 * boleh diubah lagi statusnya — kunjungannya sudah ada di antrian, dan menandainya
 * "ditolak" cuma bikin dua layar bercerita beda.
 */
async function putuskan(formData: FormData, status: "dikonfirmasi" | "ditolak" | "batal") {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const catatan = String(formData.get("catatan") ?? "").trim().slice(0, 300) || null;
  if (!id) redirect("/klinik/booking?error=" + encodeURIComponent("Booking tidak dikenal"));

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("bookings").update({
    status, catatan_staf: catatan,
    handled_by: user?.id ?? null, handled_at: new Date().toISOString(),
  }).eq("id", id).is("visit_id", null);

  if (error) redirect("/klinik/booking?error=" + encodeURIComponent(error.message));
  revalidatePath("/klinik/booking");
  redirect(`/klinik/booking?success=${status}`);
}

export async function konfirmasiBooking(formData: FormData) {
  await putuskan(formData, "dikonfirmasi");
}

export async function tolakBooking(formData: FormData) {
  await putuskan(formData, "ditolak");
}

export async function batalkanBooking(formData: FormData) {
  await putuskan(formData, "batal");
}
