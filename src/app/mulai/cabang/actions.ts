"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bolehBukaPath } from "@/lib/akses";
import { aturanEfektif, bacaAkses } from "@/lib/akses-akun";
import { branchCookie, branchSelectionUrl } from "@/lib/operational-context";
import { resolveOperationalBranch } from "@/lib/operational-branch";
import { getOpenShift } from "@/lib/shift";

export async function pilihCabang(form: FormData) {
  const modeInput = String(form.get("mode") ?? "");
  if (modeInput !== "klinik" && modeInput !== "petshop") redirect("/mulai");
  const mode = modeInput;
  const branchId = String(form.get("branchId") ?? "");
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");
  // E3 (meeting 12 Nov 2026): hak buka memakai akses efektif akun (peran + sub-menu + akses khusus).
  const [{ data: profile }, akses] = await Promise.all([
    client.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle(),
    bacaAkses(client),
  ]);
  const rulesError = akses.rulesError;
  const destination = mode === "klinik" ? "/klinik" : "/kasir";
  if (rulesError || !profile?.is_active || !bolehBukaPath(profile.role, destination, aturanEfektif(profile.role, akses))) redirect("/mulai");
  const branch = await resolveOperationalBranch(client, user.id, mode, branchId);
  const fail = (error: string) => redirect(`${branchSelectionUrl(mode)}&error=${encodeURIComponent(error)}`);
  if (!branch) fail("Cabang tidak tersedia untuk akun ini. Pilih ulang atau hubungi admin.");
  const shift = await getOpenShift(client, user.id, mode);
  if (shift && shift.branch_id !== branchId) fail("Tutup shift berjalan sebelum pindah cabang.");
  (await cookies()).set(branchCookie(mode), JSON.stringify({ userId: user.id, branchId }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/",
  });
  redirect(destination);
}
