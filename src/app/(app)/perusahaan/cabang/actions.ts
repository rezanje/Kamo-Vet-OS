"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const PATH = "/perusahaan/cabang";

// Admin gate mirrors the RLS user_branches_admin_write policy (OWNER/ADMIN).
// RLS is the real enforcement; this just yields a friendly message instead of a
// silent no-op when a non-admin submits.
async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`${PATH}?error=${encodeURIComponent("Hanya owner/admin yang bisa mengatur pengguna cabang")}`);
  }
  return supabase;
}

export async function assignUser(formData: FormData) {
  const supabase = await requireAdmin();
  const user_id = String(formData.get("user_id") ?? "");
  const branch_id = String(formData.get("branch_id") ?? "");
  const role = formData.get("role") === "SECONDARY" ? "SECONDARY" : "PRIMARY";
  if (!user_id || !branch_id) {
    redirect(`${PATH}?error=${encodeURIComponent("Pilih pengguna dulu")}`);
  }

  const { error } = await supabase
    .from("user_branches")
    .upsert({ user_id, branch_id, role }, { onConflict: "user_id,branch_id" });
  if (error) redirect(`${PATH}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(PATH);
  redirect(`${PATH}?success=1`);
}

export async function unassignUser(formData: FormData) {
  const supabase = await requireAdmin();
  const user_id = String(formData.get("user_id") ?? "");
  const branch_id = String(formData.get("branch_id") ?? "");

  const { error } = await supabase
    .from("user_branches").delete().eq("user_id", user_id).eq("branch_id", branch_id);
  if (error) redirect(`${PATH}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(PATH);
  redirect(`${PATH}?success=1`);
}
