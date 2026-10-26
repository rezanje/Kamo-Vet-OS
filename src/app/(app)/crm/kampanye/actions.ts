"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertMasterAdmin } from "@/lib/master-guard";
import { parseCampaignBinding } from "@/lib/campaign-binding";

const BACK = "/crm/kampanye";

export async function saveCampaignBinding(form: FormData) {
  const db = await assertMasterAdmin(BACK, "relasi kampanye");
  let input: ReturnType<typeof parseCampaignBinding>;
  try { input = parseCampaignBinding(form); }
  catch (error) { redirect(`${BACK}?error=${encodeURIComponent(error instanceof Error ? error.message : "Konfigurasi tidak valid")}`); }
  const id = String(form.get("id") ?? "");
  const table = input.bindingType === "transaction_voucher" ? "vouchers" : "promos";
  const { data: target, error: targetError } = await db.from(table).select("id").eq("id", input.targetId).maybeSingle();
  if (targetError || !target) redirect(`${BACK}?error=${encodeURIComponent("Voucher atau promo sumber tidak tersedia.")}`);
  // A campaign alias must not accidentally redeem through the legacy voucher
  // path while this configuration-only binding has no approved runtime rule.
  const { data: legacy, error: legacyError } = await db.from("vouchers").select("id").eq("code", input.code).maybeSingle();
  if (legacyError || legacy) redirect(`${BACK}?error=${encodeURIComponent("Kode ini sudah merupakan voucher transaksi. Pilih kode kampanye lain.")}`);
  const row = {
    code: input.code, binding_type: input.bindingType,
    voucher_id: input.bindingType === "transaction_voucher" ? input.targetId : null,
    promo_id: input.bindingType === "product_promo" ? input.targetId : null,
    calculation_mode: input.calculationMode,
    updated_at: new Date().toISOString(),
  };
  const result = id
    ? await db.from("campaign_code_bindings").update(row).eq("id", id)
    : await db.from("campaign_code_bindings").insert(row);
  if (result.error) redirect(`${BACK}?error=${encodeURIComponent(result.error.code === "23505" ? "Kode kampanye sudah digunakan." : "Relasi kampanye gagal disimpan. Coba lagi.")}`);
  revalidatePath(BACK);
  redirect(`${BACK}?saved=1`);
}

export async function deleteCampaignBinding(form: FormData) {
  const db = await assertMasterAdmin(BACK, "relasi kampanye");
  const id = String(form.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect(`${BACK}?error=${encodeURIComponent("Relasi kampanye tidak valid.")}`);
  const { error } = await db.from("campaign_code_bindings").delete().eq("id", id);
  if (error) redirect(`${BACK}?error=${encodeURIComponent("Relasi kampanye gagal dihapus. Coba lagi.")}`);
  revalidatePath(BACK);
  redirect(BACK);
}
