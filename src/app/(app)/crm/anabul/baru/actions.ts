"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function simpanAnabul(formData: FormData) {
  const supabase = await createClient();

  // ponytail: customer_id comes from hidden field (pre-selected) or select dropdown.
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim();
  const species = String(formData.get("species") ?? "").trim();
  const breed = String(formData.get("breed") ?? "").trim() || null;
  const gender = String(formData.get("gender") ?? "").trim() || null;
  const dob = String(formData.get("dob") ?? "") || null;
  const weightRaw = formData.get("weight");
  const weight = weightRaw ? Number(weightRaw) : null;
  const warna = String(formData.get("warna") ?? "").trim() || null;
  const sterilisasi = String(formData.get("sterilisasi") ?? "").trim() || null;
  const golongan_darah = String(formData.get("golongan_darah") ?? "").trim() || null;
  const microchip = String(formData.get("microchip") ?? "").trim() || null;
  const alergi = String(formData.get("alergi") ?? "").trim() || null;
  const kondisi_khusus = String(formData.get("kondisi_khusus") ?? "").trim() || null;

  if (!customerId || !nama) {
    redirect(
      `/crm/anabul/baru?error=${encodeURIComponent("Pelanggan dan nama anabul wajib diisi")}&customer=${customerId}`
    );
  }

  const { error } = await supabase.from("pets").insert({
    customer_id: customerId,
    name: nama,
    species,
    breed,
    gender,
    dob,
    weight,
    warna,
    sterilisasi,
    golongan_darah,
    microchip,
    alergi,
    kondisi_khusus,
    status: "Aktif",
  });

  if (error) {
    redirect(
      `/crm/anabul/baru?error=${encodeURIComponent(error.message)}&customer=${customerId}`
    );
  }

  redirect("/crm/pelanggan?success=pet");
}
