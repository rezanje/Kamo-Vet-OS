"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeKode } from "@/lib/voucher";

const BACK = "/crm/voucher";

// Voucher = potongan uang langsung — sama kelasnya dengan promo, jadi dikunci
// ke OWNER/ADMIN dengan pola yang sama seperti crm/promo/actions.ts.
async function requireManager() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`${BACK}?error=${encodeURIComponent("Hanya owner/manajer yang bisa mengatur voucher")}`);
  }
  return supabase;
}

export async function simpanVoucher(formData: FormData) {
  const supabase = await requireManager();

  const id = String(formData.get("id") ?? "").trim();
  const code = normalizeKode(formData.get("code"));
  const tipe = String(formData.get("tipe") ?? "nominal");
  const nilai = Number(formData.get("nilai"));
  const validFrom = String(formData.get("valid_from") ?? "").trim() || null;
  const validUntil = String(formData.get("valid_until") ?? "").trim() || null;

  const maxRaw = String(formData.get("max_potongan") ?? "").trim();
  const maxPotongan = maxRaw ? Number(maxRaw) : null;
  const minBelanja = Number(formData.get("min_belanja") ?? 0) || 0;
  const bolehGabung = String(formData.get("boleh_gabung_promo") ?? "") === "1";
  // Sasaran voucher (meeting 14 Agustus): kosong = terbuka untuk siapa pun.
  const customerId = String(formData.get("customer_id") ?? "").trim() || null;
  const categoryId = String(formData.get("category_id") ?? "").trim() || null;

  if (!code) redirect(`${BACK}?error=${encodeURIComponent("Kode voucher wajib diisi")}`);
  if (!Number.isFinite(nilai) || nilai <= 0) {
    redirect(`${BACK}?error=${encodeURIComponent("Nilai voucher harus lebih dari 0")}`);
  }
  if (tipe === "persen" && nilai > 100) {
    redirect(`${BACK}?error=${encodeURIComponent("Diskon persen tidak boleh lebih dari 100%")}`);
  }
  // Rentang terbalik lolos diam-diam = voucher yang tidak pernah bisa dipakai.
  if (validFrom && validUntil && validUntil < validFrom) {
    redirect(`${BACK}?error=${encodeURIComponent("Tanggal berakhir lebih awal dari tanggal mulai")}`);
  }
  if (maxPotongan !== null && (!Number.isFinite(maxPotongan) || maxPotongan <= 0)) {
    redirect(`${BACK}?error=${encodeURIComponent("Maks. potongan harus lebih dari 0, atau kosongkan kalau tanpa batas")}`);
  }
  if (minBelanja < 0) {
    redirect(`${BACK}?error=${encodeURIComponent("Min. belanja tidak boleh negatif")}`);
  }
  // Plafon di bawah nilai voucher nominal berarti nilainya tidak pernah tercapai —
  // ditolak di sini supaya tidak jadi voucher yang membingungkan di kasir.
  if (maxPotongan !== null && tipe === "nominal" && maxPotongan < nilai) {
    redirect(`${BACK}?error=${encodeURIComponent("Maks. potongan lebih kecil dari nilai voucher — naikkan batasnya atau turunkan nilainya")}`);
  }

  // Dua sasaran sekaligus bikin aturannya tidak jelas dibaca kasir — dan pada
  // praktiknya pelanggan tertentu SUDAH punya golongan.
  if (customerId && categoryId) {
    redirect(`${BACK}?error=${encodeURIComponent("Pilih salah satu: pelanggan tertentu ATAU golongan pelanggan")}`);
  }

  const row = {
    code, tipe, nilai, valid_from: validFrom, valid_until: validUntil,
    max_potongan: maxPotongan, min_belanja: minBelanja, boleh_gabung_promo: bolehGabung,
    customer_id: customerId, category_id: categoryId,
  };
  const { error } = id
    ? await supabase.from("vouchers").update(row).eq("id", id)
    : await supabase.from("vouchers").insert({ ...row, is_active: true });

  if (error) {
    const pesan = error.message.includes("vouchers_code_key")
      ? `Kode "${code}" sudah dipakai voucher lain`
      : error.message;
    redirect(`${BACK}?error=${encodeURIComponent(pesan)}`);
  }

  revalidatePath(BACK);
  redirect(`${BACK}?success=1`);
}

// Voucher tidak dihapus: struk lama menyimpan kodenya sebagai catatan historis.
// Nonaktif = tidak bisa dipakai lagi di kasir, riwayatnya tetap terbaca.
export async function toggleVoucher(formData: FormData) {
  const supabase = await requireManager();
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Voucher tidak valid")}`);

  const { error } = await supabase.from("vouchers").update({ is_active: !aktif }).eq("id", id);
  revalidatePath(BACK);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : BACK);
}
