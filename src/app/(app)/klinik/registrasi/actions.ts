"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nextQueueNumber } from "@/lib/queue";
import { cariAnabulSenama, errorAnabulKembar, pesanAnabulKembar } from "@/lib/anabul";
import { nomorHpValid, PESAN_HP_TIDAK_VALID } from "@/lib/kontak";
import { resolveDokter } from "@/lib/dokter";
import { bacaPets, susunKeluhan } from "@/lib/rombongan";

// Inti registrasi: buat/reuse pelanggan, simpan tiap anabul, buat satu kunjungan
// per hewan lengkap dengan nomor antrian berurutan.
//
// Satu pemilik boleh membawa beberapa hewan sekaligus. Kunjungannya tetap dipisah
// per hewan — rekam medis, insentif dokter, dan laporan per pasien bergantung pada
// pemisahan itu. Yang digabung cuma pengalamannya: data pemilik diisi sekali dan
// nomor antriannya beruntun supaya dokter bisa menangani berturut-turut.
//
// Return daftar visitId urut sesuai hewannya. Melempar redirect(error) sendiri.
async function daftar(formData: FormData): Promise<string[]> {
  const supabase = await createClient();

  const phone = String(formData.get("phone") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const dob = String(formData.get("dob") ?? "") || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "") || null;
  const catatan = String(formData.get("catatan") ?? "") || null;

  const poli = String(formData.get("poli") ?? "Poli Umum");
  // Dokter dipilih dari daftar karyawan; namanya diambil dari master, bukan dari
  // form, supaya nama di dokumen cetak tidak pernah beda dari orang yang dibayar.
  const { doctorId, nama: dokter } = await resolveDokter(supabase, String(formData.get("doctor_id") ?? "").trim() || null);
  const branchId = String(formData.get("branchId") ?? "");
  const kontrol = String(formData.get("kontrol") ?? "baru");
  const tujuanKontrol = String(formData.get("tujuanKontrol") ?? "").trim();

  const dibaca = bacaPets(formData.get("pets"));
  if (!dibaca.ok) {
    redirect(`/klinik/registrasi?error=${encodeURIComponent(dibaca.pesan)}`);
  }
  const pets = dibaca.ok ? dibaca.pets : [];

  if (!phone || !name || !branchId) {
    redirect(`/klinik/registrasi?error=${encodeURIComponent("Lengkapi data wajib (HP, nama, cabang)")}`);
  }

  // No. HP dipakai di bawah untuk mengenali pelanggan lama — nomor asal ("0")
  // bikin pencarian itu gagal dan satu pemilik jadi punya dua kartu.
  if (!nomorHpValid(phone)) {
    redirect(`/klinik/registrasi?error=${encodeURIComponent(PESAN_HP_TIDAK_VALID)}`);
  }

  // ponytail: lookup-by-phone reuses an existing customer instead of duplicating.
  let customerId: string;
  const { data: existing } = await supabase
    .from("customers").select("id").eq("phone", phone).maybeSingle();

  if (existing) {
    customerId = existing.id;
  } else {
    const { data: created, error } = await supabase
      .from("customers").insert({ name, phone, dob, email, address, catatan }).select("id").single();
    if (error || !created) {
      redirect(`/klinik/registrasi?error=${encodeURIComponent(error?.message ?? "Gagal simpan pelanggan")}`);
    }
    customerId = created!.id;
  }

  // Nomor antrian [Huruf][3 digit] per cabang per hari (Addendum §4). Dibaca SEKALI
  // lalu ditambah di memori: kalau dibaca ulang tiap hewan, tiga kunjungan yang
  // dibuat dalam hitungan milidetik bisa dapat nomor yang sama.
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const { data: todayQ } = await supabase
    .from("visits").select("queue_number")
    .eq("branch_id", branchId).gte("created_at", startOfDay.toISOString());
  const nomorTerpakai = (todayQ ?? []).map((v) => v.queue_number as string);

  const visitIds: string[] = [];

  for (const p of pets) {
    // p.id diisi kalau staf memilih "anabul terdaftar" dari lookup no. HP — kartu
    // itu dipakai ulang, cuma berat & foto yang diperbarui (data master lain jangan
    // ketimpa diam-diam).
    //
    // Kalau staf TIDAK memilih dari daftar tapi mengetik nama yang sudah ada di
    // pemilik ini, itu tetap maksudnya hewan yang sama — kartunya dipakai ulang,
    // bukan ditolak. Menolak cuma bikin staf mengarang nama baru ("Michi 2") dan
    // riwayat medisnya tetap terpecah.
    const senama = p.id ? null : await cariAnabulSenama(supabase, customerId, p.name);
    const reuseId = p.id || senama?.id || null;

    let finalPetId: string;
    if (reuseId) {
      const patch: Record<string, unknown> = {};
      if (p.weight != null) patch.weight = p.weight;
      if (p.photo_url) patch.photo_url = p.photo_url;
      if (Object.keys(patch).length) await supabase.from("pets").update(patch).eq("id", reuseId);
      finalPetId = reuseId;
    } else {
      const { data: pet, error: petErr } = await supabase
        .from("pets")
        .insert({
          customer_id: customerId, name: p.name, species: p.species,
          breed: p.breed || null, warna: p.warna || null, dob: p.dob || null,
          gender: p.gender, weight: p.weight, sterilisasi: p.sterilisasi,
          microchip: p.microchip || null, alergi: p.alergi || null,
          kondisi_khusus: p.kondisi_khusus || null, golongan_darah: p.golongan_darah || null,
          photo_url: p.photo_url || null,
        })
        .select("id").single();
      if (petErr || !pet) {
        // Balapan dua staf menyimpan bersamaan: index DB yang menahan, bukan cek di atas.
        const pesan = errorAnabulKembar(petErr?.message)
          ? pesanAnabulKembar(p.name)
          : petErr?.message ?? "Gagal simpan data hewan";
        redirect(`/klinik/registrasi?error=${encodeURIComponent(pesan)}`);
      }
      finalPetId = pet!.id;
    }

    const queueNumber = nextQueueNumber(poli, nomorTerpakai);
    nomorTerpakai.push(queueNumber);

    const { data: visit, error: visitErr } = await supabase
      .from("visits")
      .insert({
        branch_id: branchId, customer_id: customerId, pet_id: finalPetId,
        poli, dokter, doctor_id: doctorId,
        keluhan: susunKeluhan(p.keluhan, kontrol, tujuanKontrol),
        status: "Menunggu", queue_number: queueNumber,
      })
      .select("id").single();
    if (visitErr || !visit) {
      redirect(`/klinik/registrasi?error=${encodeURIComponent(visitErr?.message ?? "Gagal buat kunjungan")}`);
    }
    visitIds.push(visit!.id);
  }

  // Booking online yang jadi kunjungan ditandai di sini — supaya satu booking
  // tidak bisa didaftarkan dua kali dan staf tahu mana pesanan yang sudah datang.
  const bookingId = String(formData.get("bookingId") ?? "").trim();
  if (bookingId && visitIds.length) {
    await supabase.from("bookings").update({
      status: "dikonfirmasi", visit_id: visitIds[0], handled_at: new Date().toISOString(),
    }).eq("id", bookingId).is("visit_id", null);
  }

  return visitIds;
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
  const ids = await daftar(formData);
  redirect(`/klinik/antrian?success=${ids.length}`);
}

// "Simpan dan Pembayaran": daftar lalu langsung ke kasir. Rombongan diarahkan ke
// kunjungan pertama; kunjungan saudaranya muncul di layar pembayaran itu.
export async function registrasiDanBayar(formData: FormData) {
  const ids = await daftar(formData);
  redirect(`/klinik/pembayaran/${ids[0]}`);
}
