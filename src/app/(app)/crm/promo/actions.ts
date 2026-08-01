"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const BACK = "/crm/promo";

// Konfigurasi promo dari pusat — khusus OWNER/ADMIN.
async function requireManager() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`${BACK}?error=${encodeURIComponent("Hanya owner/manajer yang bisa mengatur promo")}`);
  }
  return supabase;
}

// Angka opsional: kosong = tidak diatur (null), bukan 0. Bedanya penting —
// max_qty 0 berarti "tidak ada yang dapat potongan".
function angkaOpsional(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function createPromo(formData: FormData) {
  const supabase = await requireManager();
  const name = String(formData.get("name") ?? "").trim();
  const promoType = String(formData.get("promo_type") ?? "diskon_produk");
  const suggest = String(formData.get("suggest") ?? "").trim();
  const discountType = String(formData.get("discount_type") ?? "") || null;
  const discountValue = angkaOpsional(formData.get("discount_value"));
  const minQty = angkaOpsional(formData.get("min_qty"));
  const maxQty = angkaOpsional(formData.get("max_qty"));
  const minSubtotal = angkaOpsional(formData.get("min_subtotal"));
  const kelipatan = String(formData.get("kelipatan") ?? "") === "1";
  const autoApply = String(formData.get("auto_apply") ?? "") === "1";
  const validFrom = String(formData.get("valid_from") ?? "").trim() || null;
  const validUntil = String(formData.get("valid_until") ?? "").trim() || null;
  const branchIds = formData.getAll("branch_ids").map(String).filter(Boolean);
  const itemIds = [...new Set(formData.getAll("item_ids").map(String).filter(Boolean))];

  const gagal = (pesan: string) => redirect(`${BACK}?error=${encodeURIComponent(pesan)}`);

  if (!name || !suggest) gagal("Nama & teks saran wajib diisi");

  // Divalidasi di sini supaya pesannya ramah, DAN di database (constraint
  // promos_diskon_wajar / promos_qty_wajar) supaya jalur lain tidak bisa
  // menyelundupkan nilai yang bikin perhitungan kasir ngawur.
  if (discountType) {
    if (discountValue == null || discountValue <= 0) gagal("Nilai diskon harus lebih dari 0");
    if (discountType === "percent" && discountValue! > 100) gagal("Diskon persen tidak boleh lebih dari 100%");
  }
  if (minQty != null && minQty <= 0) gagal("Min. qty harus lebih dari 0");
  if (maxQty != null && maxQty <= 0) gagal("Maks. qty harus lebih dari 0");
  if (minQty != null && maxQty != null && maxQty < minQty) gagal("Maks. qty tidak boleh lebih kecil dari min. qty");
  if (validFrom && validUntil && validUntil < validFrom) gagal("Tanggal berakhir lebih awal dari tanggal mulai");

  // Potong otomatis tanpa nilai diskon = promo yang terlihat aktif di daftar
  // tapi tidak memotong apa pun. Ditolak supaya tidak menyesatkan.
  if (autoApply && (!discountType || discountValue == null)) {
    gagal("Potong otomatis butuh jenis & nilai diskon terisi");
  }
  if (autoApply && kelipatan && minQty == null) {
    gagal("Aturan kelipatan butuh min. qty terisi");
  }

  // `rule` dipertahankan untuk teks saran & min. subtotal (dibaca reminder lama).
  const rule: Record<string, unknown> = { suggest };
  if (minSubtotal != null) rule.min_subtotal = minSubtotal;

  const { data: promo, error } = await supabase.from("promos").insert({
    name, promo_type: promoType, rule,
    min_qty: minQty, max_qty: maxQty, kelipatan, auto_apply: autoApply,
    discount_type: discountType, discount_value: discountValue,
    branch_ids: branchIds.length ? branchIds : null, // kosong = semua cabang
    valid_from: validFrom, valid_until: validUntil, is_active: true,
  }).select("id").single();

  if (error || !promo) gagal(error?.message ?? "Gagal simpan promo");

  if (itemIds.length) {
    const { error: itErr } = await supabase.from("promo_items")
      .insert(itemIds.map((item_id) => ({ promo_id: promo!.id, item_id })));
    // Promo TANPA daftar barang berlaku untuk SEMUA barang. Jadi kalau daftarnya
    // gagal tersimpan, promonya diam-diam jadi jauh lebih luas dari yang dimaksud —
    // lebih aman batalkan promonya sekalian.
    if (itErr) {
      await supabase.from("promos").delete().eq("id", promo!.id);
      gagal(`Gagal simpan daftar barang promo: ${itErr.message}`);
    }
  }

  revalidatePath(BACK);
  redirect(`${BACK}?success=1`);
}

export async function togglePromo(formData: FormData) {
  const supabase = await requireManager();
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  await supabase.from("promos").update({ is_active: active }).eq("id", id);
  revalidatePath(BACK);
  redirect(BACK);
}
