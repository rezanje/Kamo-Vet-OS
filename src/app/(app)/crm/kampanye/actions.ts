"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertMasterAdmin } from "@/lib/master-guard";
import { pesanGagalKampanye } from "@/lib/kode-kampanye";
import { normalizeKode } from "@/lib/voucher";

const BACK = "/crm/kampanye";
const UUID = /^[0-9a-f-]{36}$/i;
const gagal = (pesan: string): never => redirect(`${BACK}?error=${encodeURIComponent(pesan)}`);

// Kode kampanye (C05): hanya OWNER/ADMIN. RLS database menolak peran lain juga.
export async function simpanKodeKampanye(form: FormData) {
  const db = await assertMasterAdmin(BACK, "kode kampanye");
  const id = String(form.get("id") ?? "");
  const code = normalizeKode(form.get("code"));
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) gagal("Kode 3–24 huruf/angka, tanpa spasi.");
  const [jenis, targetId] = String(form.get("target") ?? "").split(":");
  if ((jenis !== "voucher" && jenis !== "promo") || !UUID.test(targetId ?? "")) gagal("Pilih voucher atau promo tujuan.");
  const rawCap = String(form.get("max_uses") ?? "").trim();
  const cap = rawCap === "" ? null : Number(rawCap);
  if (cap !== null && (!Number.isInteger(cap) || cap <= 0)) gagal("Batas pemakaian harus bilangan bulat > 0, atau kosong untuk tanpa batas.");
  const note = String(form.get("note") ?? "").trim().slice(0, 200) || null;

  const row = {
    code, voucher_id: jenis === "voucher" ? targetId : null, promo_id: jenis === "promo" ? targetId : null,
    max_uses: cap, note, is_active: String(form.get("is_active") ?? "1") === "1", updated_at: new Date().toISOString(),
  };
  const { error } = UUID.test(id)
    ? await db.from("campaign_codes").update(row).eq("id", id)
    : await db.from("campaign_codes").insert(row);
  if (error) {
    gagal(pesanGagalKampanye(error.message)
      ?? (error.code === "23505" ? "Kode kampanye sudah dipakai." : "Kode kampanye gagal disimpan. Coba lagi."));
  }
  revalidatePath(BACK);
  redirect(`${BACK}?success=1`);
}

export async function aturStatusKodeKampanye(form: FormData) {
  const db = await assertMasterAdmin(BACK, "kode kampanye");
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) gagal("Kode kampanye tidak valid.");
  const { error } = await db.from("campaign_codes")
    .update({ is_active: String(form.get("is_active")) === "1", updated_at: new Date().toISOString() }).eq("id", id);
  if (error) gagal("Status kode gagal diubah. Coba lagi.");
  revalidatePath(BACK);
  redirect(BACK);
}
