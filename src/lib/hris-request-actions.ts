import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
export function pesanPengajuan(error: { code?: string; message?: string }) {
  if (error.code === "PGRST202" || error.code === "42P01")
    return "Fitur pengajuan belum aktif. Hubungi admin sistem.";
  if (error.code === "23505")
    return "Pengajuan untuk tanggal/sumber ini sudah ada.";
  if (error.code === "40P01" || error.code === "40001")
    return "Pengajuan sedang berubah. Muat ulang dan coba lagi.";
  return error.message?.startsWith("HRIS:")
    ? error.message.replace(/^HRIS:\s*/, "")
    : "Pengajuan gagal disimpan. Periksa data dan akses.";
}
export const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export async function submitStaffRequest(
  kind: string,
  payload: Record<string, unknown>,
  back = "/me",
  employee: string | null = null,
) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await db.rpc("hris_submit_staff_request", {
    p_kind: kind,
    p_payload: payload,
    p_employee: employee,
  });
  redirect(
    `${back}?${new URLSearchParams(error ? { error: pesanPengajuan(error) } : { success: ({ leave: "cuti", overtime: "lembur", cash: "kasbon", reimburse: "reimburse" } as Record<string, string>)[kind] ?? kind })}`,
  );
}
