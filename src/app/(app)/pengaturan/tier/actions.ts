"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { jalankanPerawatanLoyalty } from "@/lib/loyalty-server";
import { angkaIsian } from "@/lib/form-angka";

export async function updateTierSettings(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/pengaturan/tier?error=${encodeURIComponent("Hanya owner/admin")}`);
  }

  // Semua angka wajib diketik: kolom kosong tidak boleh jadi 0 / angka bawaan diam-diam.
  const kolom = ["bronze_min", "silver_min", "gold_min", "platinum_min", "points_expiry_months", "tier_downgrade_days"];
  const isian = new Map(kolom.map((k) => [k, angkaIsian(formData, k)]));
  if ([...isian.values()].some((v) => v === null || v < 0)) {
    redirect(`/pengaturan/tier?error=${encodeURIComponent("Semua angka wajib diisi (tidak boleh negatif)")}`);
  }
  const num = (k: string) => isian.get(k) as number;
  const bronze_min = num("bronze_min"), silver_min = num("silver_min"), gold_min = num("gold_min"), platinum_min = num("platinum_min");
  if (!(bronze_min < silver_min && silver_min < gold_min && gold_min < platinum_min)) {
    redirect(`/pengaturan/tier?error=${encodeURIComponent("Threshold harus naik: Bronze < Silver < Gold < Platinum")}`);
  }

  const pointsExpiryEnabled = formData.get("points_expiry_enabled") === "on";
  const pointsExpiryMonths = Math.max(1, Math.min(120, Math.floor(num("points_expiry_months"))));
  const downgradeEnabled = formData.get("tier_downgrade_enabled") === "on";
  const downgradeDays = Math.max(1, Math.min(3650, Math.floor(num("tier_downgrade_days"))));

  // Benefit tiap level = satu golongan (boleh kosong). Id dari form diverifikasi: harus
  // golongan aktif, kecuali golongan yang memang sudah terpasang (dibiarkan apa adanya).
  const kolomBenefit = ["bronze_category_id", "silver_category_id", "gold_category_id", "platinum_category_id"] as const;
  const benefit = Object.fromEntries(kolomBenefit.map((k) => [k, String(formData.get(k) ?? "").trim() || null])) as Record<(typeof kolomBenefit)[number], string | null>;
  const dipilih = [...new Set(Object.values(benefit).filter((v): v is string => !!v))];
  if (dipilih.length) {
    const [{ data: kat, error: katError }, { data: lama, error: lamaError }] = await Promise.all([
      supabase.from("customer_categories").select("id, is_active").in("id", dipilih),
      supabase.from("tier_settings").select(kolomBenefit.join(", ")).eq("id", 1).maybeSingle(),
    ]);
    if (katError || lamaError) redirect(`/pengaturan/tier?error=${encodeURIComponent("Golongan benefit belum dapat diperiksa, coba lagi")}`);
    const aktif = new Map(((kat ?? []) as { id: string; is_active: boolean }[]).map((k) => [k.id, k.is_active]));
    const terpasang = (lama ?? {}) as Partial<Record<(typeof kolomBenefit)[number], string | null>>;
    const salah = kolomBenefit.some((k) => benefit[k] && !aktif.get(benefit[k]!) && benefit[k] !== terpasang[k]);
    if (salah) redirect(`/pengaturan/tier?error=${encodeURIComponent("Golongan benefit tidak valid atau sudah nonaktif")}`);
  }

  // Tabel satu baris: upsert, lalu pastikan benar-benar 1 baris tertulis.
  // Update atas baris yang belum ada lolos tanpa error padahal tidak menyimpan apa pun.
  const { data, error } = await supabase.from("tier_settings").upsert({
    id: 1,
    bronze_min, silver_min, gold_min, platinum_min,
    points_expiry_enabled: pointsExpiryEnabled,
    points_expiry_months: pointsExpiryMonths,
    tier_downgrade_enabled: downgradeEnabled,
    tier_downgrade_days: downgradeDays,
    ...benefit,
  }, { onConflict: "id" }).select("id");
  if (error || !Array.isArray(data) || data.length !== 1) {
    redirect("/pengaturan/tier?error=" + encodeURIComponent("Gagal menyimpan aturan loyalty"));
  }
  revalidatePath("/pengaturan/tier");
  redirect("/pengaturan/tier?success=1");
}

export async function jalankanPerawatanLoyaltyAction() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || me.role !== "OWNER") {
    redirect("/pengaturan/tier?error=" + encodeURIComponent("Hanya OWNER yang bisa menjalankan perawatan loyalty"));
  }
  const hasil = await jalankanPerawatanLoyalty(supabase);
  revalidatePath("/pengaturan/tier");
  redirect("/pengaturan/tier?success=" + encodeURIComponent("Perawatan selesai: " + hasil.expiredPoints + " poin hangus, " + hasil.downgradedCustomers + " tier turun"));
}


/**
 * Tutup poin akhir tahun (permintaan Pak Andri, meeting 14 Agustus).
 *
 * Poin yang tidak pernah hangus jadi kewajiban yang menumpuk tanpa batas — dan
 * itulah yang bikin program loyalty susah dihitung untungnya. Penutupan dicatat
 * di buku poin per pelanggan, bukan diam-diam di-nol-kan: pelanggan yang protes
 * harus bisa ditunjukkan kapan poinnya hangus.
 *
 * Idempoten per tahun: ref "TUTUP-<tahun>" dicek dulu, jadi tombolnya tidak bisa
 * menghanguskan poin dua kali (dan poin yang diperoleh setelah penutupan aman).
 */
export async function tutupPoinTahunan(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  // Menghanguskan poin seluruh pelanggan = keputusan pemilik, bukan admin harian.
  if (!me || me.role !== "OWNER") {
    redirect(`/pengaturan/tier?error=${encodeURIComponent("Hanya OWNER yang boleh menutup poin tahunan")}`);
  }

  const tahun = String(formData.get("tahun") ?? "").trim();
  if (!/^\d{4}$/.test(tahun)) {
    redirect(`/pengaturan/tier?error=${encodeURIComponent("Tahun penutupan tidak valid")}`);
  }
  const ref = `TUTUP-${tahun}`;

  const { count } = await supabase
    .from("point_ledger").select("*", { count: "exact", head: true }).eq("ref", ref);
  if ((count ?? 0) > 0) {
    redirect(`/pengaturan/tier?error=${encodeURIComponent(`Poin tahun ${tahun} sudah pernah ditutup`)}`);
  }

  const { data: pelanggan } = await supabase
    .from("customers").select("id, points").gt("points", 0);
  const daftar = (pelanggan ?? []) as { id: string; points: number }[];
  if (daftar.length === 0) {
    redirect(`/pengaturan/tier?error=${encodeURIComponent("Tidak ada pelanggan yang masih punya poin")}`);
  }

  const { error } = await supabase.from("point_ledger").insert(
    daftar.map((c) => ({
      customer_id: c.id, delta: -Number(c.points), saldo: 0, ref,
      description: `Poin hangus tutup tahun ${tahun}`,
    })),
  );
  if (error) {
    redirect(`/pengaturan/tier?error=${encodeURIComponent("Gagal mencatat penutupan poin")}`);
  }
  await supabase.from("customers").update({ points: 0 }).gt("points", 0);

  revalidatePath("/pengaturan/tier");
  redirect(`/pengaturan/tier?success=${encodeURIComponent(`Poin ${daftar.length} pelanggan ditutup untuk tahun ${tahun}`)}`);
}
