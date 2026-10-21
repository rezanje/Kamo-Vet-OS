"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { lifecycleInput, MASTER_PATHS, masterReturn } from "@/lib/master-lifecycle";

export async function changeMasterLifecycle(formData: FormData): Promise<{ error: string }> {
  let input;
  try { input = lifecycleInput(formData); }
  catch (error) { return { error: error instanceof Error ? error.message : "Tindakan tidak valid." }; }
  const back = masterReturn(input.entity, String(formData.get("filters") ?? ""));
  const supabase = await assertMasterAdmin(back, "master data");
  const { data, error } = await supabase.rpc("change_master_data_lifecycle", {
    p_entity: input.entity, p_id: input.id, p_action: input.action,
    p_expected_revision: input.revision, p_reason: input.reason,
  });
  if (error || !data?.id) return { error: error?.message ?? "Hasil belum terkonfirmasi. Muat ulang daftar untuk memeriksa status sebelum mencoba lagi." };
  for (const path of Object.values(MASTER_PATHS)) revalidatePath(path.split("?")[0]);
  revalidatePath("/pos/sku/baru");
  revalidatePath("/pembelian/baru");
  revalidatePath(`/hris/karyawan/${input.id}`);
  revalidatePath(`/pos/sku/${input.id}`);
  const message = input.action === "trash" ? "Data dipindahkan ke Sampah dan dapat dipulihkan." : input.action === "restore" ? "Data dipulihkan dalam status Nonaktif. Aktifkan terpisah bila diperlukan." : "Status master diperbarui; riwayat tetap tersimpan.";
  redirect(`${back}${back.includes("?") ? "&" : "?"}success=${encodeURIComponent(message)}`);
}
