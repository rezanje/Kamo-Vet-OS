"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function updateTierSettings(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/pengaturan/tier?error=${encodeURIComponent("Hanya owner/admin")}`);
  }

  const num = (k: string) => Math.max(0, Number(formData.get(k)) || 0);
  const bronze_min = num("bronze_min"), silver_min = num("silver_min"), gold_min = num("gold_min"), platinum_min = num("platinum_min");
  if (!(bronze_min < silver_min && silver_min < gold_min && gold_min < platinum_min)) {
    redirect(`/pengaturan/tier?error=${encodeURIComponent("Threshold harus naik: Bronze < Silver < Gold < Platinum")}`);
  }

  await supabase.from("tier_settings").update({ bronze_min, silver_min, gold_min, platinum_min }).eq("id", 1);
  revalidatePath("/pengaturan/tier");
  redirect("/pengaturan/tier?success=1");
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
