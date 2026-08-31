"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
  await supabase.from("visits").delete().eq("id", id).eq("status", "Menunggu");
  revalidatePath("/klinik/antrian");
}
