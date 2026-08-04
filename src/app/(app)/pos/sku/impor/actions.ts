"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bacaCsv, periksaBaris, type BarisSalah, type MasterImpor } from "@/lib/impor-barang";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/pos/sku/impor";

async function assertBolehKelola() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") {
    redirect(`${BACK}?error=${encodeURIComponent("Hanya OWNER/ADMIN yang boleh mengimpor barang")}`);
  }
  return supabase;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function muatMaster(supabase: any): Promise<MasterImpor> {
  const [{ data: kat }, { data: merek }, { data: satuan }, { data: items }] = await Promise.all([
    supabase.from("item_categories").select("id, name").eq("is_active", true),
    supabase.from("brands").select("id, name"),
    supabase.from("units").select("nama").eq("is_active", true),
    supabase.from("items").select("code"),
  ]);

  return {
    kategori: new Map(((kat ?? []) as { id: string; name: string }[]).map((k) => [k.name.toLowerCase(), k.id])),
    merek: new Map(((merek ?? []) as { id: string; name: string }[]).map((b) => [b.name.toLowerCase(), b.id])),
    satuan: new Set(((satuan ?? []) as { nama: string }[]).map((u) => u.nama.toLowerCase())),
    kodeTerpakai: new Set(((items ?? []) as { code: string | null }[])
      .map((i) => (i.code ?? "").toLowerCase()).filter(Boolean)),
  };
}

/** Ringkas baris bermasalah jadi satu pesan yang muat di URL. */
function ringkasSalah(salah: BarisSalah[]): string {
  const tampil = salah.slice(0, 8).map((s) => `baris ${s.no} (${s.kode}): ${s.pesan}`);
  const sisa = salah.length - tampil.length;
  return tampil.join(" · ") + (sisa > 0 ? ` · dan ${sisa} baris lain` : "");
}

export async function imporBarang(formData: FormData) {
  const supabase = await assertBolehKelola();
  const gagal = (pesan: string) => redirect(`${BACK}?error=${encodeURIComponent(pesan)}`);

  const isi = String(formData.get("csv") ?? "");
  if (!isi.trim()) gagal("Belum ada file atau isian CSV.");

  const dibaca = bacaCsv(isi);
  if (!dibaca.ok) gagal(dibaca.pesan);
  if (!dibaca.ok) return; // penyempit tipe; redirect di atas tidak pernah balik

  const { siap, salah } = periksaBaris(dibaca.baris, await muatMaster(supabase));

  // Tidak ada satu pun baris yang bisa masuk — kembalikan daftar masalahnya utuh,
  // jangan "berhasil 0 barang" yang bikin pemakai kira filenya sudah beres.
  if (siap.length === 0) {
    gagal(`Tidak ada baris yang bisa disimpan. ${ringkasSalah(salah)}`);
  }

  const { error } = await supabase.from("items").insert(
    siap.map((b) => ({ ...b, is_active: true })),
  );
  if (error) gagal(pesanSimpanGagal(error.message));

  const pesan = salah.length === 0
    ? `${siap.length} barang berhasil diimpor.`
    : `${siap.length} barang diimpor, ${salah.length} baris dilewati — ${ringkasSalah(salah)}`;

  redirect(`/pos/sku?success=${encodeURIComponent(pesan)}`);
}
