"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nomorHpValid, PESAN_HP_TIDAK_VALID } from "@/lib/kontak";

export async function simpanPelanggan(formData: FormData) {
  const supabase = await createClient();

  // ponytail: extract + trim all fields before validation.
  const nama = String(formData.get("nama") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const dob = String(formData.get("dob") ?? "") || null;
  const alamat = String(formData.get("alamat") ?? "").trim() || null;
  const pekerjaan = String(formData.get("pekerjaan") ?? "").trim() || null;
  const sumber_info = String(formData.get("sumber_info") ?? "").trim() || null;
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  if (!nama || !phone) {
    redirect(
      `/crm/pelanggan/baru?error=${encodeURIComponent("Nama dan No. HP wajib diisi")}`
    );
  }

  // No. HP adalah kunci pengenal pelanggan lama di semua layar — nomor asal
  // ("0") bikin dedup gagal dan satu orang punya dua kartu.
  if (!nomorHpValid(phone)) {
    redirect(`/crm/pelanggan/baru?error=${encodeURIComponent(PESAN_HP_TIDAK_VALID)}`);
  }

  // ponytail: dedup by phone — same as registrasi pattern, but here we reject duplicates.
  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (existing) {
    redirect(
      `/crm/pelanggan/baru?error=${encodeURIComponent("No HP sudah terdaftar")}`
    );
  }

  const { error } = await supabase.from("customers").insert({
    name: nama, phone, email, dob, address: alamat, pekerjaan, sumber_info, catatan,
  });

  if (error) {
    redirect(
      `/crm/pelanggan/baru?error=${encodeURIComponent(error.message)}`
    );
  }

  redirect("/crm/pelanggan?success=cust");
}
