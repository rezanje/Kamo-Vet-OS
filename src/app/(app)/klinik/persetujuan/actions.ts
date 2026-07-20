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
