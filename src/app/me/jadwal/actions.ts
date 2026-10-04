"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pesanJadwal } from "@/lib/schedule-request";
export async function ajukanPerubahanJadwal(form: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const value = (key: string) => String(form.get(key) ?? "").trim();
  const { error } = await supabase.rpc("hris_request_schedule_change", {
    p_schedule_id: value("schedule_id"),
    p_expected_updated_at: value("updated_at"),
    p_shift_id: value("shift_id"),
    p_branch_id: value("branch_id"),
    p_reason: value("reason"),
  });
  redirect(
    `/me/jadwal?${new URLSearchParams(error ? { error: pesanJadwal(error) } : { success: "1" })}`,
  );
}
