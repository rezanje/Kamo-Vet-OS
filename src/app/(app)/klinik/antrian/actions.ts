"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ALASAN_ARSIP_MAX, ALASAN_ARSIP_MIN, bolehArsip, pesanArsip } from "@/lib/antrian-arsip";

export async function updateVisitStatus(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  // Addendum §4: "Panggil" mencatat waktu panggil.
  if (status === "Diperiksa") {
    const { error } = await supabase.rpc("set_visit_service_state", { p_visit_id: id, p_action: "start" });
    if (error) redirect(`/klinik/antrian?error=${encodeURIComponent(error.message)}`);
  } else {
    const { error } = await supabase.from("visits").update({ status }).eq("id", id);
    if (error) redirect(`/klinik/antrian?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/klinik/antrian");
}

export async function finishVisitService(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "").trim();
  const { error } = await supabase.rpc("set_visit_service_state", { p_visit_id: id, p_action: "finish" });
  if (error) redirect(`/klinik/antrian?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/klinik/antrian");
}

export async function checkoutVisit(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "").trim();
  const { error } = await supabase.rpc("set_visit_service_state", { p_visit_id: id, p_action: "checkout" });
  if (error) redirect(`/klinik/antrian?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/klinik/antrian");
}

export async function assignVisitProvider(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "").trim();
  const providerId = String(formData.get("provider_id") ?? "").trim();
  const { error } = await supabase.rpc("set_visit_service_state", {
    p_visit_id: id, p_action: "provider", p_provider_id: providerId,
  });
  if (error) redirect(`/klinik/antrian/${id}?error=${encodeURIComponent(error.message)}`);
  revalidatePath(`/klinik/antrian/${id}`);
  redirect(`/klinik/antrian/${id}?success=provider`);
}

// Batal hanya untuk pasien yang belum diperiksa (status Menunggu) — belum ada rekam medis,
// jadi hard delete aman tanpa kehilangan data klinis.
export async function cancelVisit(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id"));
  // Baris yang diarsipkan tidak pernah ikut terhapus lewat Batal (arsip = sembunyi, bukan hapus).
  await supabase.from("visits").delete().eq("id", id).eq("status", "Menunggu").is("archived_at", null);
  revalidatePath("/klinik/antrian");
}

// Arsip / Pulihkan (Andri 4 Nov 2026): hanya OWNER dan ADMIN aktif. Peran dicek di sini sebelum memanggil RPC, dan RPC
// (SECURITY DEFINER) mengulang pengecekan di database beserta syarat arsip di bawah kunci baris kunjungan.
async function peranBolehArsip(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  return bolehArsip(profile);
}

const galat = (pesan: string, filter?: string) =>
  `/klinik/antrian?${filter ? `filter=${filter}&` : ""}error=${encodeURIComponent(pesan)}`;
const PESAN_PERAN = "Hanya pemilik atau admin yang boleh mengarsipkan atau memulihkan antrean.";

export async function archiveVisit(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const requestKey = String(formData.get("request_key") ?? "").trim();
  if (!(await peranBolehArsip(supabase))) redirect(galat(PESAN_PERAN));
  if (reason.length < ALASAN_ARSIP_MIN || reason.length > ALASAN_ARSIP_MAX) {
    redirect(galat(`Isi alasan arsip minimal ${ALASAN_ARSIP_MIN} dan maksimal ${ALASAN_ARSIP_MAX} karakter.`));
  }
  if (!id || requestKey.length < 8) redirect(galat("Muat ulang halaman lalu coba arsipkan lagi."));
  const { error } = await supabase.rpc("clinic_archive_visit", { p_visit_id: id, p_reason: reason, p_request_key: requestKey });
  if (error) redirect(galat(pesanArsip(error.message)));
  revalidatePath("/klinik/antrian");
  redirect("/klinik/antrian?success=arsip");
}

export async function unarchiveVisit(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "").trim();
  const requestKey = String(formData.get("request_key") ?? "").trim();
  if (!(await peranBolehArsip(supabase))) redirect(galat(PESAN_PERAN, "diarsipkan"));
  if (!id || requestKey.length < 8) redirect(galat("Muat ulang halaman lalu coba pulihkan lagi.", "diarsipkan"));
  const { error } = await supabase.rpc("clinic_unarchive_visit", { p_visit_id: id, p_reason: null, p_request_key: requestKey });
  if (error) redirect(galat(pesanArsip(error.message), "diarsipkan"));
  revalidatePath("/klinik/antrian");
  redirect("/klinik/antrian?filter=diarsipkan&success=pulih");
}
