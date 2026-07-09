"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nextQueueNumber } from "@/lib/queue";

// Inti registrasi: buat/reuse pelanggan, simpan anabul, buat visit + nomor antrian.
// Return visitId supaya caller bisa arahkan ke antrian atau langsung pembayaran.
// Melempar redirect(error) sendiri kalau ada kegagalan.
async function daftar(formData: FormData): Promise<string> {
  const supabase = await createClient();

  const phone = String(formData.get("phone") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const dob = String(formData.get("dob") ?? "") || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "") || null;
  const tier = String(formData.get("tier") ?? "New") || "New";
  const catatan = String(formData.get("catatan") ?? "") || null;

  const petName = String(formData.get("petName") ?? "").trim();
  const species = String(formData.get("species") ?? "");
  const breed = String(formData.get("breed") ?? "") || null;
  const warna = String(formData.get("warna") ?? "") || null;
  const petDob = String(formData.get("petDob") ?? "") || null;
  const gender = String(formData.get("gender") ?? "");
  const weightRaw = formData.get("weight");
  const weight = weightRaw ? Number(weightRaw) : null;
  const sterilisasi = String(formData.get("sterilisasi") ?? "") || null;
  const microchip = String(formData.get("microchip") ?? "") || null;
  const alergi = String(formData.get("alergi") ?? "") || null;
  const kondisi_khusus = String(formData.get("kondisi_khusus") ?? "") || null;
  const golongan_darah = String(formData.get("golongan_darah") ?? "") || null;
  const petId = String(formData.get("petId") ?? "").trim() || null;
  const photoUrl = String(formData.get("photoUrl") ?? "").trim() || null;

  const poli = String(formData.get("poli") ?? "Poli Umum");
  const dokter = String(formData.get("dokter") ?? "") || null;
  const branchId = String(formData.get("branchId") ?? "");
  const kontrol = String(formData.get("kontrol") ?? "baru");
  const tujuanKontrol = String(formData.get("tujuanKontrol") ?? "").trim();
  let keluhan = String(formData.get("keluhan") ?? "") || null;
  if (kontrol === "ulang" && tujuanKontrol) {
    keluhan = `${keluhan ? keluhan + " " : ""}[Kontrol: ${tujuanKontrol}]`;
  }

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
      .from("customers").insert({ name, phone, dob, email, address, tier, catatan }).select("id").single();
    if (error || !created) {
      redirect(`/klinik/registrasi?error=${encodeURIComponent(error?.message ?? "Gagal simpan pelanggan")}`);
    }
    customerId = created!.id;
  }

  // petId diisi kalau staff pilih "anabul existing" dari lookup no. HP — reuse
  // pet itu, cuma update berat & foto (data master lain jangan ketimpa diam-diam).
  let finalPetId: string;
  if (petId) {
    const patch: Record<string, unknown> = {};
    if (weight != null) patch.weight = weight;
    if (photoUrl) patch.photo_url = photoUrl;
    if (Object.keys(patch).length) await supabase.from("pets").update(patch).eq("id", petId);
    finalPetId = petId;
  } else {
    const { data: pet, error: petErr } = await supabase
      .from("pets")
      .insert({ customer_id: customerId, name: petName, species, breed, warna, dob: petDob, gender, weight, sterilisasi, microchip, alergi, kondisi_khusus, golongan_darah, photo_url: photoUrl })
      .select("id").single();
    if (petErr || !pet) {
      redirect(`/klinik/registrasi?error=${encodeURIComponent(petErr?.message ?? "Gagal simpan data hewan")}`);
    }
    finalPetId = pet!.id;
  }

  // Addendum §4: nomor antrian [Huruf][3 digit] per cabang per hari, reset tiap hari.
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const { data: todayQ } = await supabase
    .from("visits").select("queue_number")
    .eq("branch_id", branchId).gte("created_at", startOfDay.toISOString());
  const queueNumber = nextQueueNumber(poli, (todayQ ?? []).map((v) => v.queue_number));

  const { data: visit, error: visitErr } = await supabase
    .from("visits")
    .insert({ branch_id: branchId, customer_id: customerId, pet_id: finalPetId, poli, dokter, keluhan, status: "Menunggu", queue_number: queueNumber })
    .select("id").single();
  if (visitErr || !visit) {
    redirect(`/klinik/registrasi?error=${encodeURIComponent(visitErr?.message ?? "Gagal buat kunjungan")}`);
  }

  return visit!.id;
}

export type PetLite = {
  id: string; name: string; species: string | null; breed: string | null; warna: string | null;
  dob: string | null; gender: string | null; weight: number | null; sterilisasi: string | null;
  microchip: string | null; alergi: string | null; kondisi_khusus: string | null;
  golongan_darah: string | null; photo_url: string | null;
};
export type CustomerLite = {
  id: string; name: string; dob: string | null; email: string | null; address: string | null; tier: string;
};

// Dipanggil dari client saat staff selesai isi no. HP — "panggil data anabul
// existing" (referensi). Kalau nomor sudah terdaftar, kembalikan pemilik + anabul-anabulnya.
export async function lookupPetsByPhone(phone: string): Promise<{ customer: CustomerLite | null; pets: PetLite[] }> {
  const supabase = await createClient();
  const p = phone.trim();
  if (!p) return { customer: null, pets: [] };

  const { data: customer } = await supabase
    .from("customers").select("id, name, dob, email, address, tier").eq("phone", p).maybeSingle();
  if (!customer) return { customer: null, pets: [] };

  const { data: pets } = await supabase
    .from("pets")
    .select("id, name, species, breed, warna, dob, gender, weight, sterilisasi, microchip, alergi, kondisi_khusus, golongan_darah, photo_url")
    .eq("customer_id", customer.id).eq("status", "Aktif").order("name");

  return { customer, pets: pets ?? [] };
}

export async function registrasiPasien(formData: FormData) {
  await daftar(formData);
  redirect("/klinik/antrian?success=1");
}

// "Simpan dan Pembayaran": daftar lalu langsung ke kasir pembayaran visit ini.
export async function registrasiDanBayar(formData: FormData) {
  const visitId = await daftar(formData);
  redirect(`/klinik/pembayaran/${visitId}`);
}
