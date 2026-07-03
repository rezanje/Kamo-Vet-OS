"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canTransition, isTerminal, ripWaMessage, type Condition, type Role } from "@/lib/inpatient";
import { sendWA } from "@/lib/fonnte";

// Admit pasien rawat inap dari rekam medis (popup design klinik/07).
export async function admitInpatient(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const visitId = String(formData.get("visitId") ?? "");
  const treatmentPlan = String(formData.get("treatment_plan") ?? "").trim();
  const doctorName = String(formData.get("doctor_name") ?? "").trim();
  const back = `/klinik/rekam-medis/${visitId}`;
  if (!visitId || !treatmentPlan) redirect(`${back}?error=${encodeURIComponent("Isi rencana tindakan rawat inap")}`);

  const { data: visit } = await supabase.from("visits").select("branch_id, dokter").eq("id", visitId).maybeSingle();
  if (!visit) redirect(`${back}?error=${encodeURIComponent("Kunjungan tidak ditemukan")}`);

  const { data: mr } = await supabase
    .from("medical_records").select("id").eq("visit_id", visitId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const { data: rec, error } = await supabase
    .from("inpatient_records")
    .insert({
      branch_id: visit!.branch_id, visit_id: visitId, medical_record_id: mr?.id ?? null,
      doctor_name: doctorName || visit!.dokter || null, treatment_plan: treatmentPlan,
      created_by: user?.id ?? null,
    })
    .select("id").single();
  if (error || !rec) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Gagal admit rawat inap")}`);

  await supabase.from("inpatient_status_log").insert({
    inpatient_record_id: rec!.id, previous_status: null, new_status: "stabil",
    changed_by: user?.id ?? null, notes: "Admit rawat inap",
  });

  redirect(`/klinik/rawat-inap/${rec!.id}?success=admit`);
}

// Laporan harian — append-only (§3 dashboard req): entry baru, tidak pernah overwrite.
export async function addDailyLog(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const recordId = String(formData.get("recordId") ?? "");
  const conditionNote = String(formData.get("condition_note") ?? "").trim();
  const tindakan = String(formData.get("tindakan") ?? "").trim() || null;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;
  const doctorName = String(formData.get("doctor_name") ?? "").trim() || null;
  const back = `/klinik/rawat-inap/${recordId}`;
  if (!recordId || !conditionNote) redirect(`${back}?error=${encodeURIComponent("Isi kondisi pasien")}`);

  const { error } = await supabase.from("inpatient_daily_logs").insert({
    inpatient_record_id: recordId, condition_note: conditionNote, tindakan, keterangan,
    doctor_name: doctorName, created_by: user?.id ?? null,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  redirect(`${back}?success=log`);
}

// Ubah kondisi (stabil/kritis/sembuh/rip) — rip hanya dokter, wajib tercatat di status log.
export async function changeCondition(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const recordId = String(formData.get("recordId") ?? "");
  const newStatus = String(formData.get("new_status") ?? "") as Condition;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const back = `/klinik/rawat-inap/${recordId}`;
  if (!recordId || !["stabil", "kritis", "sembuh", "rip"].includes(newStatus)) {
    redirect(`${back}?error=${encodeURIComponent("Status tidak valid")}`);
  }

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!canTransition((me?.role ?? "STAFF") as Role, newStatus)) {
    redirect(`${back}?error=${encodeURIComponent("Transisi ke RIP hanya boleh dilakukan oleh dokter")}`);
  }

  const { data: rec } = await supabase
    .from("inpatient_records").select("condition_status").eq("id", recordId).single();
  if (!rec) redirect(`${back}?error=${encodeURIComponent("Data rawat inap tidak ditemukan")}`);
  if (rec!.condition_status === newStatus) redirect(back);

  await supabase.from("inpatient_status_log").insert({
    inpatient_record_id: recordId, previous_status: rec!.condition_status, new_status: newStatus,
    changed_by: user?.id ?? null, notes,
  });

  await supabase
    .from("inpatient_records")
    .update({
      condition_status: newStatus,
      // §3: rip/sembuh otomatis keluar dari dashboard aktif; invoice TIDAK diblokir.
      ...(isTerminal(newStatus) ? { discharged_at: new Date().toISOString() } : { discharged_at: null }),
    })
    .eq("id", recordId);

  // rip → layar review WA dulu (spec default: review sebelum kirim, bukan auto-send).
  redirect(newStatus === "rip" ? `${back}?wa=review` : `${back}?success=status`);
}

// Kirim WA duka (template khusus) setelah dokter review — trigger terpisah dari WA engine rutin.
export async function sendRipWa(formData: FormData) {
  const supabase = await createClient();
  const recordId = String(formData.get("recordId") ?? "");
  const back = `/klinik/rawat-inap/${recordId}`;

  const { data: rec } = await supabase
    .from("inpatient_records")
    .select("condition_status, visits(pets(name), customers(name, phone), branches(name))")
    .eq("id", recordId).maybeSingle();
  if (!rec || rec.condition_status !== "rip") redirect(`${back}?error=${encodeURIComponent("WA duka hanya untuk status RIP")}`);

  type Rel<T> = T | T[] | null;
  const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);
  const visit = one(rec!.visits as Rel<{ pets: Rel<{ name: string }>; customers: Rel<{ name: string; phone: string }>; branches: Rel<{ name: string }> }>);
  const pet = one(visit?.pets ?? null);
  const cust = one(visit?.customers ?? null);
  const branch = one(visit?.branches ?? null);
  if (!cust?.phone) redirect(`${back}?error=${encodeURIComponent("Nomor HP pemilik tidak ada")}`);

  const result = await sendWA(cust!.phone, ripWaMessage(pet?.name ?? "anabul Anda", cust!.name, branch?.name ?? "klinik kami"));
  redirect(result.ok ? `${back}?success=wa` : `${back}?error=${encodeURIComponent("WA gagal terkirim: " + (result.reason ?? ""))}`);
}
