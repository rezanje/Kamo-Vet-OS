"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const BACK = "/klinik/persetujuan";

export async function simpanTemplate(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const id = String(formData.get("id") ?? "");
  const nama = String(formData.get("nama") ?? "").trim();
  const isi = String(formData.get("isi") ?? "").trim();
  const branchId = String(formData.get("branchId") ?? "") || null;

  if (!nama || !isi) redirect(`${BACK}?error=${encodeURIComponent("Nama dan isi template wajib diisi")}`);

  if (id) {
    const { error } = await supabase
      .from("consent_templates")
      .update({ nama, isi, branch_id: branchId, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) redirect(`${BACK}?error=${encodeURIComponent(error.message)}`);
  } else {
    const { error } = await supabase
      .from("consent_templates")
      .insert({ nama, isi, branch_id: branchId, created_by: user?.id ?? null });
    if (error) redirect(`${BACK}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(BACK);
  redirect(`${BACK}?success=1`);
}

export async function toggleTemplate(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Template tidak valid")}`);

  await supabase.from("consent_templates")
    .update({ is_active: !aktif, updated_at: new Date().toISOString() }).eq("id", id);

  revalidatePath(BACK);
  redirect(BACK);
}

/**
 * Aturan tindakan mana yang wajib berformulir, plus formulir bawaannya.
 * Dulu daftarnya dikunci di kode; sekarang klinik mengaturnya sendiri di layar ini.
 */
export async function simpanAturanConsent(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`${BACK}?error=${encodeURIComponent("Hanya owner/admin yang bisa mengubah aturan formulir")}`);
  }

  const { TINDAKAN_KATEGORI } = await import("@/lib/tindakan");
  const sekarang = new Date().toISOString();

  for (const kategori of TINDAKAN_KATEGORI) {
    const wajib = formData.get(`wajib__${kategori}`) === "on";
    const templateRaw = String(formData.get(`template__${kategori}`) ?? "").trim();
    // Formulir yang dipilih diverifikasi ada & masih aktif — jangan percaya kiriman layar.
    let templateId: string | null = null;
    if (templateRaw) {
      const { data: t } = await supabase
        .from("consent_templates").select("id").eq("id", templateRaw).eq("is_active", true).maybeSingle();
      templateId = t?.id ?? null;
    }
    const { error } = await supabase.from("consent_rules").upsert({
      kategori, wajib, template_id: templateId, updated_at: sekarang,
    }, { onConflict: "kategori" });
    if (error) redirect(`${BACK}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(BACK);
  redirect(`${BACK}?success=aturan`);
}
