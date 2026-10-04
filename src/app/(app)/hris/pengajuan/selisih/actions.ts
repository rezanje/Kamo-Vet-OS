"use server";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { field, pesanPengajuan } from "@/lib/hris-request-actions";
export async function prosesSelisih(f: FormData) {
  const db = await assertRole("/hris/pengajuan", "selisih kas", [
    "OWNER",
    "ADMIN",
  ]);
  const { error } = await db.rpc("hris_record_shift_shortage", {
    p_shift: field(f, "id"),
  });
  redirect(
    `/hris/pengajuan/selisih?${new URLSearchParams(error ? { error: pesanPengajuan(error) } : { success: "1" })}`,
  );
}
