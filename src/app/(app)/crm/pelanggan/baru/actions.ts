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
  // NPWP hanya perlu untuk pembeli ber-NPWP (perusahaan). Kosong itu wajar dan
  // tidak dianggap data kurang — pembeli pribadi memang tidak punya.
  const npwp = String(formData.get("npwp") ?? "").trim().slice(0, 30) || null;

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
  // Cek + insert ATOMIK di bawah kunci identitas yang sama dengan impor rekam medis & registrasi
  // klinik (08.. = +62..), jadi tidak bisa balapan.
  const { data: hasil, error } = await supabase.rpc("pelanggan_baru_atomik", {
    p_name: nama, p_phone: phone, p_email: email, p_dob: dob, p_address: alamat,
    p_pekerjaan: pekerjaan, p_sumber_info: sumber_info, p_catatan: catatan, p_npwp: npwp,
  });

  if (error) {
    redirect(
      `/crm/pelanggan/baru?error=${encodeURIComponent(error.message)}`
    );
  }

  const tambah = hasil as { status?: unknown } | null;
  if (tambah?.status === "terdaftar") {
    redirect(
      `/crm/pelanggan/baru?error=${encodeURIComponent("No HP sudah terdaftar")}`
    );
  }
  if (tambah?.status !== "dibuat") {
    redirect(
      `/crm/pelanggan/baru?error=${encodeURIComponent("Gagal simpan pelanggan")}`
    );
  }

  redirect("/crm/pelanggan?success=cust");
}
