"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validasiBooking, normalPhone, type BookingDraft } from "@/lib/booking";
import { hariIniWIB } from "@/lib/tanggal";

/**
 * Kiriman formulir publik. Semua isian diperiksa ulang di sini (dan sekali lagi
 * oleh RLS di database) — yang mengirim bisa siapa saja, termasuk yang tidak
 * memakai layar kami.
 */
export async function kirimBooking(formData: FormData) {
  const s = (k: string) => String(formData.get(k) ?? "").trim();

  const draft: BookingDraft = {
    branchId: s("branch_id"),
    poli: s("poli"),
    tanggal: s("tanggal"),
    jam: s("jam"),
    namaPemilik: s("nama_pemilik"),
    phone: s("phone"),
    namaHewan: s("nama_hewan"),
    jenisHewan: s("jenis_hewan"),
    keluhan: s("keluhan"),
  };

  const salah = validasiBooking(draft, hariIniWIB());
  if (salah) redirect(`/booking?error=${encodeURIComponent(salah)}`);

  const supabase = await createClient();
  const { error } = await supabase.from("bookings").insert({
    branch_id: draft.branchId,
    poli: draft.poli,
    tanggal: draft.tanggal,
    jam: draft.jam,
    nama_pemilik: draft.namaPemilik.slice(0, 80),
    phone: normalPhone(draft.phone),
    nama_hewan: draft.namaHewan.slice(0, 60),
    jenis_hewan: draft.jenisHewan,
    keluhan: draft.keluhan.slice(0, 500) || null,
    status: "baru",
  });

  if (error) {
    // Pesan database tidak ditampilkan mentah ke publik — cukup arahkan apa yang
    // bisa dilakukan pengirim.
    const pesan = /Terlalu banyak booking/.test(error.message)
      ? "Nomor ini sudah punya beberapa booking di tanggal tersebut. Hubungi klinik lewat WhatsApp kalau perlu jadwal tambahan."
      : "Booking gagal terkirim. Coba lagi sebentar lagi atau hubungi klinik langsung.";
    redirect(`/booking?error=${encodeURIComponent(pesan)}`);
  }

  redirect("/booking?sukses=1");
}
