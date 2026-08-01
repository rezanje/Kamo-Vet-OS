"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cariAnabulSenama, errorAnabulKembar, pesanAnabulKembar } from "@/lib/anabul";

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

  // Layar ini artinya "tambah anabul BARU" — beda dari registrasi klinik yang
  // memakai ulang kartu lama. Di sini nama kembar ditolak dengan pesan jelas,
  // karena menambah kartu kedua untuk hewan yang sama memecah riwayat medisnya.
  const senama = await cariAnabulSenama(supabase, customerId, nama);
  if (senama) {
    redirect(
      `/crm/anabul/baru?error=${encodeURIComponent(pesanAnabulKembar(nama))}&customer=${customerId}`
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
    // Balapan dua staff menyimpan bersamaan: index yang menahan, bukan cek di atas.
    const pesan = errorAnabulKembar(error.message) ? pesanAnabulKembar(nama) : error.message;
    redirect(
      `/crm/anabul/baru?error=${encodeURIComponent(pesan)}&customer=${customerId}`
    );
  }

  redirect("/crm/pelanggan?success=pet");
}
