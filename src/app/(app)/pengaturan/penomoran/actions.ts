"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FORMAT_BAWAAN, periksaDigit, periksaPola } from "@/lib/no-dokumen";

const kembali = (q: string) => redirect(`/pengaturan/penomoran?${q}`);

async function pastikanBoleh() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    kembali(`error=${encodeURIComponent("Hanya owner/admin yang boleh mengubah format nomor dokumen.")}`);
  }
  return { supabase, userId: user?.id ?? null };
}

export async function simpanFormatNomor(formData: FormData) {
  const { supabase, userId } = await pastikanBoleh();

  const jenis = String(formData.get("jenis") ?? "");
  const bawaan = FORMAT_BAWAAN.find((f) => f.jenis === jenis);
  if (!bawaan) kembali(`error=${encodeURIComponent("Jenis dokumen tidak dikenal.")}`);

  const pola = String(formData.get("pola") ?? "").trim();
  const digit = Number(formData.get("digit"));

  const salahPola = periksaPola(pola);
  if (salahPola) kembali(`error=${encodeURIComponent(salahPola)}`);
  const salahDigit = periksaDigit(digit);
  if (salahDigit) kembali(`error=${encodeURIComponent(salahDigit)}`);

  // Awalan yang sama untuk dua jenis dokumen berbeda membuat nomornya saling
  // menabrak: pencarian nomor tertinggi memakai awalan, jadi seri yang satu akan
  // melanjutkan nomor seri yang lain.
  const { data: lain } = await supabase
    .from("document_numbering").select("jenis").eq("pola", pola).neq("jenis", jenis);
  if ((lain ?? []).length > 0) {
    kembali(`error=${encodeURIComponent(`Awalan "${pola}" sudah dipakai jenis dokumen lain. Nomornya akan saling menabrak.`)}`);
  }
  const bentrokBawaan = FORMAT_BAWAAN.find((f) => f.jenis !== jenis && f.pola === pola);
  if (bentrokBawaan) {
    kembali(`error=${encodeURIComponent(`Awalan "${pola}" sama dengan bawaan ${bentrokBawaan.label}. Pilih awalan lain.`)}`);
  }

  const { error } = await supabase.from("document_numbering").upsert({
    jenis, pola, digit, updated_at: new Date().toISOString(), updated_by: userId,
  }, { onConflict: "jenis" });
  if (error) kembali(`error=${encodeURIComponent(error.message)}`);

  revalidatePath("/pengaturan/penomoran");
  kembali(`success=${encodeURIComponent(`Format ${bawaan!.label} tersimpan.`)}`);
}

export async function kembalikanBawaan(formData: FormData) {
  const { supabase } = await pastikanBoleh();
  const jenis = String(formData.get("jenis") ?? "");
  const bawaan = FORMAT_BAWAAN.find((f) => f.jenis === jenis);
  if (!bawaan) kembali(`error=${encodeURIComponent("Jenis dokumen tidak dikenal.")}`);

  await supabase.from("document_numbering").delete().eq("jenis", jenis);
  revalidatePath("/pengaturan/penomoran");
  kembali(`success=${encodeURIComponent(`Format ${bawaan!.label} dikembalikan ke bawaan.`)}`);
}
