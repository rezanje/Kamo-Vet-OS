"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Tandai / lepas flag bahan baku racikan pada satu item.
export async function setBahanBaku(itemId: string, value: boolean) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .update({ is_compound_material: value })
    .eq("id", itemId)
    .select("id");
  if (error) return { ok: false as const, error: error.message };
  // RLS yang menolak update mengembalikan 0 baris tanpa error — perlakukan sbg gagal
  // supaya UI optimistik tidak menampilkan sukses palsu.
  if (!data || data.length === 0) return { ok: false as const, error: "Tidak berizin mengubah master barang." };
  revalidatePath("/klinik/bahan-baku");
  return { ok: true as const };
}

export async function setBahanBakuBanyak(itemIds: string[], value: boolean) {
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false as const, error: "Belum ada barang yang dipilih." };

  const supabase = await createClient();
  const { data: before, error: beforeError } = await supabase
    .from("items")
    .select("id, is_compound_material")
    .in("id", ids)
    .eq("is_active", true)
    .eq("item_type", "Persediaan");
  if (beforeError) return { ok: false as const, error: beforeError.message };
  if ((before?.length ?? 0) !== ids.length) return { ok: false as const, error: "Sebagian barang sudah tidak aktif atau tidak ditemukan." };

  const berhasil: string[] = [];
  const rollback = async () => {
    const lamaAktif = (before ?? []).filter((row) => berhasil.includes(row.id) && row.is_compound_material).map((row) => row.id);
    const lamaNonaktif = (before ?? []).filter((row) => berhasil.includes(row.id) && !row.is_compound_material).map((row) => row.id);
    if (lamaAktif.length) await supabase.from("items").update({ is_compound_material: true }).in("id", lamaAktif);
    if (lamaNonaktif.length) await supabase.from("items").update({ is_compound_material: false }).in("id", lamaNonaktif);
  };

  let updated = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const { data, error } = await supabase
      .from("items")
      .update({ is_compound_material: value })
      .in("id", batch)
      .eq("is_active", true)
      .eq("item_type", "Persediaan")
      .select("id");
    if (error) {
      await rollback();
      return { ok: false as const, error: error.message };
    }
    updated += data?.length ?? 0;
    berhasil.push(...(data ?? []).map((row) => row.id as string));
  }

  if (updated !== ids.length) {
    await rollback();
    return { ok: false as const, error: "Sebagian barang tidak berizin atau sudah tidak aktif." };
  }
  revalidatePath("/klinik/bahan-baku");
  revalidatePath("/klinik/rekam-medis");
  return { ok: true as const, updated };
}
