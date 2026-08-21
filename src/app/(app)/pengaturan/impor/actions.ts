"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bacaCsvUmum, ringkasSalah, type BarisSalah } from "@/lib/impor-csv";
import {
  periksaPelanggan, periksaPemasok, periksaAkun, type AkunImpor,
} from "@/lib/impor-master";
import { KONFIG, isJenisImpor, type JenisImpor } from "@/lib/impor-jenis";
import { pesanSimpanGagal } from "@/lib/barang";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function assertBoleh(back: string): Promise<Db> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") {
    redirect(`${back}?error=${encodeURIComponent("Hanya OWNER/ADMIN yang boleh mengimpor data")}`);
  }
  return supabase;
}

/** Simpan hasil impor per jenis. Mengembalikan jumlah baris yang masuk. */
async function simpan(supabase: Db, jenis: JenisImpor, baris: ReturnType<typeof bacaCsvUmum>) {
  if (!baris.ok) return { masuk: 0, salah: [] as BarisSalah[], pesanGagal: baris.pesan };

  if (jenis === "pelanggan") {
    const [{ data: kat }, { data: cust }] = await Promise.all([
      supabase.from("customer_categories").select("id, nama").eq("is_active", true),
      supabase.from("customers").select("phone"),
    ]);
    const { normalTelp } = await import("@/lib/impor-master");
    const { siap, salah } = periksaPelanggan(baris.baris, {
      kategori: new Map(((kat ?? []) as { id: string; nama: string }[]).map((k) => [k.nama.toLowerCase(), k.id])),
      telpTerpakai: new Set(((cust ?? []) as { phone: string | null }[])
        .map((c) => normalTelp(c.phone ?? "")).filter(Boolean)),
    });
    if (siap.length === 0) return { masuk: 0, salah, pesanGagal: null };
    const { error } = await supabase.from("customers").insert(siap);
    if (error) return { masuk: 0, salah, pesanGagal: pesanSimpanGagal(error.message) };
    return { masuk: siap.length, salah, pesanGagal: null };
  }

  if (jenis === "pemasok") {
    const [{ data: kat }, { data: sup }] = await Promise.all([
      supabase.from("supplier_categories").select("id, nama").eq("is_active", true),
      supabase.from("suppliers").select("nama"),
    ]);
    const { siap, salah } = periksaPemasok(baris.baris, {
      kategori: new Map(((kat ?? []) as { id: string; nama: string }[]).map((k) => [k.nama.toLowerCase(), k.id])),
      namaTerpakai: new Set(((sup ?? []) as { nama: string }[]).map((s) => s.nama.toLowerCase())),
    });
    if (siap.length === 0) return { masuk: 0, salah, pesanGagal: null };
    const { error } = await supabase.from("suppliers").insert(siap);
    if (error) return { masuk: 0, salah, pesanGagal: pesanSimpanGagal(error.message) };
    return { masuk: siap.length, salah, pesanGagal: null };
  }

  // Bagan akun: induk baru bisa dipasang SETELAH semua akun ada, karena satu file
  // boleh memuat induk beserta rinciannya sekaligus.
  const { data: akunAda } = await supabase.from("coa_accounts").select("id, code");
  const kodeKeId = new Map(((akunAda ?? []) as { id: string; code: string }[])
    .map((a) => [a.code.toLowerCase(), a.id]));

  const { siap, salah } = periksaAkun(baris.baris, { kodeTerpakai: new Set(kodeKeId.keys()) });
  if (siap.length === 0) return { masuk: 0, salah, pesanGagal: null };

  const { data: baru, error } = await supabase.from("coa_accounts").insert(
    siap.map((a: AkunImpor) => ({
      code: a.code, name: a.name, type: a.type,
      normal_balance: a.normal_balance, is_header: a.is_header, is_active: true,
    })),
  ).select("id, code");
  if (error) return { masuk: 0, salah, pesanGagal: pesanSimpanGagal(error.message) };

  for (const a of ((baru ?? []) as { id: string; code: string }[])) {
    kodeKeId.set(a.code.toLowerCase(), a.id);
  }

  const indukTakKetemu: string[] = [];
  for (const a of siap) {
    if (!a.induk) continue;
    const parentId = kodeKeId.get(a.induk.toLowerCase());
    if (!parentId) { indukTakKetemu.push(`${a.code} → ${a.induk}`); continue; }
    await supabase.from("coa_accounts")
      .update({ parent_id: parentId }).eq("id", kodeKeId.get(a.code.toLowerCase()));
  }
  if (indukTakKetemu.length > 0) {
    salah.push({
      no: 0, kode: "induk",
      pesan: `akun masuk tapi induknya tidak ditemukan: ${indukTakKetemu.slice(0, 5).join(", ")}`,
    });
  }

  return { masuk: siap.length, salah, pesanGagal: null };
}

export async function imporMaster(formData: FormData) {
  const jenisTeks = String(formData.get("jenis") ?? "");
  if (!isJenisImpor(jenisTeks)) redirect("/pengaturan?error=" + encodeURIComponent("Jenis impor tidak dikenal"));
  const jenis = jenisTeks as JenisImpor;
  const konfig = KONFIG[jenis];
  const back = `/pengaturan/impor/${jenis}`;

  const supabase = await assertBoleh(back);
  const gagal = (pesan: string): never => redirect(`${back}?error=${encodeURIComponent(pesan)}`);

  const isi = String(formData.get("csv") ?? "");
  if (!isi.trim()) gagal("Belum ada file atau isian CSV.");

  const dibaca = bacaCsvUmum(isi, konfig.kolom, konfig.wajib);
  if (!dibaca.ok) gagal(dibaca.pesan);

  const { masuk, salah, pesanGagal } = await simpan(supabase, jenis, dibaca);
  if (pesanGagal) gagal(pesanGagal);

  // Tidak ada satu pun baris yang bisa masuk — kembalikan daftar masalahnya utuh,
  // jangan "berhasil 0" yang bikin pemakai kira filenya sudah beres.
  if (masuk === 0) gagal(`Tidak ada baris yang bisa disimpan. ${ringkasSalah(salah)}`);

  const label = jenis === "akun" ? "akun" : jenis;
  const pesan = salah.length === 0
    ? `${masuk} ${label} berhasil diimpor.`
    : `${masuk} ${label} diimpor, ${salah.length} baris dilewati — ${ringkasSalah(salah)}`;

  redirect(`${konfig.kembali}${konfig.kembali.includes("?") ? "&" : "?"}success=${encodeURIComponent(pesan)}`);
}
