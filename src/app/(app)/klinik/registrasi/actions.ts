"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nextQueueNumber } from "@/lib/queue";

export async function registrasiPasien(formData: FormData) {
  const supabase = await createClient();

  const phone = String(formData.get("phone") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const dob = String(formData.get("dob") ?? "") || null;
  const address = String(formData.get("address") ?? "") || null;
  const petName = String(formData.get("petName") ?? "").trim();
  const species = String(formData.get("species") ?? "");
  const breed = String(formData.get("breed") ?? "") || null;
  const petDob = String(formData.get("petDob") ?? "") || null;
  const gender = String(formData.get("gender") ?? "");
  const weightRaw = formData.get("weight");
  const weight = weightRaw ? Number(weightRaw) : null;
  const poli = String(formData.get("poli") ?? "Poli Umum");
  const branchId = String(formData.get("branchId") ?? "");
  const keluhan = String(formData.get("keluhan") ?? "") || null;

  if (!phone || !name || !petName || !branchId) {
    redirect(`/klinik/registrasi?error=${encodeURIComponent("Lengkapi data wajib (HP, nama, hewan, cabang)")}`);
  }

  // ponytail: lookup-by-phone reuses an existing customer instead of duplicating.
  let customerId: string;
  const { data: existing } = await supabase
    .from("customers").select("id").eq("phone", phone).maybeSingle();

  if (existing) {
    customerId = existing.id;
  } else {
    const { data: created, error } = await supabase
      .from("customers").insert({ name, phone, dob, address }).select("id").single();
    if (error || !created) {
      redirect(`/klinik/registrasi?error=${encodeURIComponent(error?.message ?? "Gagal simpan pelanggan")}`);
    }
    customerId = created!.id;
  }

  const { data: pet, error: petErr } = await supabase
    .from("pets")
    .insert({ customer_id: customerId, name: petName, species, breed, dob: petDob, gender, weight })
    .select("id").single();
  if (petErr || !pet) {
    redirect(`/klinik/registrasi?error=${encodeURIComponent(petErr?.message ?? "Gagal simpan data hewan")}`);
  }

  // Addendum §4: nomor antrian [Huruf][3 digit] per cabang per hari, reset tiap hari.
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const { data: todayQ } = await supabase
    .from("visits").select("queue_number")
    .eq("branch_id", branchId).gte("created_at", startOfDay.toISOString());
  const queueNumber = nextQueueNumber(poli, (todayQ ?? []).map((v) => v.queue_number));

  const { error: visitErr } = await supabase
    .from("visits")
    .insert({ branch_id: branchId, customer_id: customerId, pet_id: pet!.id, poli, keluhan, status: "Menunggu", queue_number: queueNumber });
  if (visitErr) {
    redirect(`/klinik/registrasi?error=${encodeURIComponent(visitErr.message)}`);
  }

  redirect("/klinik/antrian?success=1");
}
