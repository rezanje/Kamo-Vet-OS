"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canSign, renderTemplate, type ConsentVars } from "@/lib/consent";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

// Buat form persetujuan: render template jadi teks final lalu SIMPAN SALINANNYA.
// Snapshot wajib — kalau template diedit belakangan, dokumen yang sudah ditandatangani
// harus tetap menunjukkan apa yang benar-benar disetujui saat itu.
export async function buatConsent(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const visitId = String(formData.get("visitId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  const tindakan = String(formData.get("tindakan") ?? "").trim();
  const back = `/klinik/rekam-medis/${visitId}`;

  if (!visitId || !templateId || !tindakan) {
    redirect(`${back}?error=${encodeURIComponent("Pilih template dan isi nama tindakan")}`);
  }

  const [{ data: tpl }, { data: visit }] = await Promise.all([
    supabase.from("consent_templates").select("id, isi").eq("id", templateId).maybeSingle(),
    supabase.from("visits")
      .select("id, dokter, created_at, pets(name, species), customers(name), branches(name)")
      .eq("id", visitId).maybeSingle(),
  ]);
  if (!tpl || !visit) redirect(`${back}?error=${encodeURIComponent("Template atau kunjungan tidak ditemukan")}`);

  const pet = one(visit.pets as Rel<{ name: string; species: string | null }>);
  const cust = one(visit.customers as Rel<{ name: string }>);
  const branch = one(visit.branches as Rel<{ name: string }>);

  const vars: ConsentVars = {
    nama_pemilik: cust?.name ?? "",
    nama_hewan: pet?.name ?? "",
    jenis_hewan: pet?.species ?? "",
    tindakan,
    dokter: visit.dokter ?? "",
    cabang: branch?.name ?? "",
    tanggal: new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }),
  };

  const { error } = await supabase.from("consents").insert({
    visit_id: visitId, template_id: tpl.id, tindakan,
    isi_snapshot: renderTemplate(tpl.isi, vars),
    status: "belum_ttd", created_by: user?.id ?? null,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(back);
  redirect(`${back}?success=consent`);
}

export async function tandaTanganConsent(formData: FormData) {
  const supabase = await createClient();

  const consentId = String(formData.get("consentId") ?? "");
  const visitId = String(formData.get("visitId") ?? "");
  const signerName = String(formData.get("signerName") ?? "").trim();
  const signature = String(formData.get("signature") ?? "");
  const back = `/klinik/rekam-medis/${visitId}`;

  if (!consentId) redirect(`${back}?error=${encodeURIComponent("Form persetujuan tidak valid")}`);
  if (!canSign(signerName, signature)) {
    redirect(`${back}?error=${encodeURIComponent("Isi nama penanda tangan dan bubuhkan tanda tangan dulu")}`);
  }

  // Sekali ditandatangani, tidak bisa ditimpa — dokumen persetujuan harus final.
  const { data: existing } = await supabase.from("consents").select("status").eq("id", consentId).maybeSingle();
  if (existing?.status === "sudah_ttd") {
    redirect(`${back}?error=${encodeURIComponent("Form ini sudah ditandatangani")}`);
  }

  const { error } = await supabase.from("consents").update({
    signer_name: signerName, signature_data: signature,
    signed_at: new Date().toISOString(), status: "sudah_ttd",
  }).eq("id", consentId);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(back);
  redirect(`${back}?success=ttd`);
}
