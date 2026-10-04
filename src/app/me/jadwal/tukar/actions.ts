"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pesanJadwal } from "@/lib/schedule-request";
const BACK = "/me/jadwal/tukar";
const value = (f: FormData, key: string) => String(f.get(key) ?? "").trim();
async function kirim(name: string, args: Record<string, unknown>) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await db.rpc(name, args);
  redirect(
    `${BACK}?${new URLSearchParams(error ? { error: pesanJadwal(error) } : { success: "1" })}`,
  );
}
export async function ajukanTukarShift(f: FormData) {
  return kirim("hris_request_schedule_swap", {
    p_own_id: value(f, "own_id"),
    p_own_version: value(f, "own_version"),
    p_peer_id: value(f, "peer_id"),
    p_peer_version: value(f, "peer_version"),
    p_branch_id: value(f, "branch_id"),
    p_reason: value(f, "reason"),
  });
}
export async function terimaTukarShift(f: FormData) {
  return kirim("hris_respond_schedule_swap", {
    p_id: value(f, "id"),
    p_accept: true,
    p_reason: value(f, "reason"),
  });
}
export async function tolakTukarShift(f: FormData) {
  return kirim("hris_respond_schedule_swap", {
    p_id: value(f, "id"),
    p_accept: false,
    p_reason: value(f, "reason"),
  });
}
export async function batalkanTukarShift(f: FormData) {
  return kirim("hris_cancel_schedule_swap", {
    p_id: value(f, "id"),
    p_reason: value(f, "reason"),
  });
}
