"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TINDAKAN_KATEGORI } from "@/lib/tindakan";

const BACK = "/pos/sku";

async function assertBolehKelola() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") {
    redirect(`${BACK}?error=${encodeURIComponent("Hanya OWNER/ADMIN yang boleh mengubah master SKU")}`);
  }
  return supabase;
}

export async function simpanSku(formData: FormData) {
  const supabase = await assertBolehKelola();

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim() || "pcs";
  const sellPrice = Number(formData.get("sell_price") ?? 0);
  const buyPrice = Number(formData.get("buy_price") ?? 0);
  const tindakanRaw = String(formData.get("tindakan_kategori") ?? "").trim();

  if (!name || !categoryId) {
    redirect(`${BACK}?error=${encodeURIComponent("Nama & kategori wajib diisi")}`);
  }
  if (!Number.isFinite(sellPrice) || sellPrice < 0) {
    redirect(`${BACK}?error=${encodeURIComponent("Harga jual tidak valid")}`);
  }

  // Kategori tindakan cuma berlaku utk SKU jasa, dan harus dari daftar resmi —
  // kalau tidak, aturan wajib-consent bisa dilewati lewat nilai karangan.
  const { data: kat } = await supabase.from("item_categories").select("name").eq("id", categoryId).maybeSingle();
  const isJasa = kat?.name === "Jasa";
  const tindakan_kategori = isJasa && (TINDAKAN_KATEGORI as readonly string[]).includes(tindakanRaw) ? tindakanRaw : null;
  if (isJasa && !tindakan_kategori) {
    redirect(`${BACK}?error=${encodeURIComponent("SKU jasa wajib punya kategori tindakan")}`);
  }

  const patch = {
    name, category_id: categoryId, code: code || null, unit,
    sell_price: sellPrice, buy_price: Number.isFinite(buyPrice) ? buyPrice : 0,
    tindakan_kategori,
  };

  const { error } = id
    ? await supabase.from("items").update(patch).eq("id", id)
    : await supabase.from("items").insert({ ...patch, is_active: true });

  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}

export async function toggleSku(formData: FormData) {
  const supabase = await assertBolehKelola();
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("SKU tidak valid")}`);

  const { error } = await supabase.from("items").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
