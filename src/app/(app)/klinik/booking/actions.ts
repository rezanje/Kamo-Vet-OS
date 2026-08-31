"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { composeBookingScheduledAt } from "@/lib/booking";
import { bolehNoShow } from "@/lib/operasional-klinik";

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

export async function markBookingNoShow(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect("/klinik/booking?error=" + encodeURIComponent("Booking tidak dikenal"));
  const { data: booking, error: loadError } = await supabase.from("bookings")
    .select("id, status, attendance_outcome, tanggal, jam, visit_id, branch_id")
    .eq("id", id).maybeSingle();
  if (loadError || !booking) redirect("/klinik/booking?error=" + encodeURIComponent(loadError?.message ?? "Booking tidak ditemukan"));
  const allowed = bolehNoShow({
    status: String(booking.status),
    outcome: (booking.attendance_outcome ?? "pending") as "pending" | "hadir" | "no_show",
    scheduledAt: composeBookingScheduledAt(String(booking.tanggal), String(booking.jam)),
    visitId: booking.visit_id ? String(booking.visit_id) : null,
  });
  if (!allowed) redirect("/klinik/booking?error=" + encodeURIComponent("Booking belum memenuhi syarat no-show"));
  const { error } = await supabase.rpc("mark_booking_no_show", { p_booking_id: id });
  if (error) redirect("/klinik/booking?error=" + encodeURIComponent(error.message));
  revalidatePath("/klinik/booking");
  redirect("/klinik/booking?success=no_show");
}
