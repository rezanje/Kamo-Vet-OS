"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { nextStatus, type RecipeStatus } from "@/lib/compounding";

import { hargaCabang, loadHargaCabang } from "@/lib/harga-cabang";
import { parseClinicPostingError, toClinicCompoundRecipeInput, type ClinicIssueCompoundParams, type ClinicVoidCompoundParams } from "@/lib/klinik-posting";

export type BahanRacikan = { id: string; name: string; unit: string; sell_price: number; stok: number };

export async function bahanRacikanUntukKunjungan(visitId: string): Promise<BahanRacikan[]> {
  const supabase = await createClient();
  const [{ data: visit }, { data: items }] = await Promise.all([
    supabase.from("visits").select("branch_id").eq("id", visitId).maybeSingle(),
    supabase.from("items").select("id, name, unit, sell_price")
      .eq("is_active", true).eq("item_type", "Persediaan").eq("is_compound_material", true)
      .order("name").limit(1000),
  ]);
  if (!visit || !items?.length) return [];
  const ids = items.map((item) => item.id as string);
  const [{ data: warehouse }, hargaMap] = await Promise.all([
    supabase.from("warehouses").select("id").eq("branch_id", visit.branch_id).eq("is_active", true).order("type").limit(1).maybeSingle(),
    loadHargaCabang(supabase, visit.branch_id, ids),
  ]);
  const { data: stockRows } = warehouse
    ? await supabase.from("stock").select("item_id, qty").eq("warehouse_id", warehouse.id).in("item_id", ids)
    : { data: [] as { item_id: string; qty: number }[] };
  const stokByItem = new Map<string, number>();
  for (const stock of stockRows ?? []) stokByItem.set(stock.item_id as string, (stokByItem.get(stock.item_id as string) ?? 0) + Number(stock.qty));
  return items.map((item) => ({
    id: item.id as string,
    name: item.name as string,
    unit: (item.unit as string) || "pcs",
    sell_price: hargaCabang(hargaMap, item.id as string, item.unit as string, Number(item.sell_price)),
    stok: stokByItem.get(item.id as string) ?? 0,
  }));
}

// Tambah racikan inline dari view rekam medis (recorded) — field ringkas sama seperti
// tab Racikan di form pemeriksaan: nama, bentuk, aturan pakai, bahan+qty. total_volume &
// petunjuk racik dibiarkan kosong (nullable, §0044). Semantik tulis = jalur simpanRekamMedis.
export async function addRacikan(formData: FormData) {
  const supabase = await createClient();

  const medicalRecordId = String(formData.get("medicalRecordId") ?? "");
  const visitId = String(formData.get("visitId") ?? "");
  const requestKey = String(formData.get("requestKey") ?? "").trim();
  const back = `/klinik/rekam-medis/${visitId}`;

  const recipeName = String(formData.get("recipe_name") ?? "").trim();
  const form = String(formData.get("dosage_form") ?? "").trim() || null;
  const aturan = String(formData.get("aturan_pakai") ?? "").trim() || null;
  if (!medicalRecordId || !recipeName) {
    redirect(`${back}?error=${encodeURIComponent("Lengkapi nama racikan")}`);
  }

  type Bahan = { item_id: string; nama: string; qty: number; satuan: string; harga: number };
  let bahan: Bahan[] = [];
  try {
    bahan = JSON.parse(String(formData.get("ingredients") ?? "[]"));
  } catch {
    bahan = [];
  }
  const ings = bahan.filter((b) => b.item_id && Number(b.qty) > 0);
  if (ings.length === 0) redirect(`${back}?error=${encodeURIComponent("Minimal 1 bahan racikan")}`);
  const params: ClinicIssueCompoundParams = {
    p_medical_record_id: medicalRecordId,
    p_visit_id: visitId,
    p_recipe: toClinicCompoundRecipeInput({
      recipeName, dosageInstruction: aturan, dosageForm: form, ingredients: ings,
    }),
    p_request_key: requestKey,
  };
  const { error } = await supabase.rpc("clinic_issue_compound", params);
  if (error) redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(error))}`);

  redirect(`/klinik/rekam-medis/${visitId}?racikan=dibuat`);
}

// Petunjuk racik diisi apoteker di halaman racik (bukan dokter): jumlah jadi + langkah
// racik teknis. Hanya selama racikan belum diserahkan.
export async function updateRacikPetunjuk(formData: FormData) {
  const supabase = await createClient();
  const recipeId = String(formData.get("recipeId") ?? "");
  const totalVolume = String(formData.get("total_volume") ?? "").trim() || null;
  const steps = String(formData.get("compounding_steps") ?? "").trim() || null;
  const back = `/klinik/racik/${recipeId}`;
  if (!recipeId) redirect(`/klinik/racik?error=${encodeURIComponent("Racikan tidak valid")}`);

  const { data: r } = await supabase.from("compounding_recipes").select("status").eq("id", recipeId).maybeSingle();
  if (!r || r.status === "handed_over" || r.status === "void") {
    redirect(`${back}?error=${encodeURIComponent("Racikan sudah diserahkan / void — tidak bisa diubah")}`);
  }

  const { error } = await supabase
    .from("compounding_recipes")
    .update({ total_volume: totalVolume, compounding_steps: steps })
    .eq("id", recipeId);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(back);
  redirect(`${back}?success=petunjuk`);
}

// pending → ready (obat siap diserahkan) → handed_over (sudah diserahkan).
export async function advanceRecipeStatus(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const recipeId = String(formData.get("recipeId") ?? "");
  if (!recipeId) redirect(`/klinik/racik?error=${encodeURIComponent("Racikan tidak valid")}`);

  const { data: r } = await supabase.from("compounding_recipes").select("status").eq("id", recipeId).single();
  const next = r ? nextStatus(r.status as RecipeStatus) : null;
  if (!next) redirect(`/klinik/racik/${recipeId}?error=${encodeURIComponent("Status tidak bisa diubah lagi")}`);

  await supabase
    .from("compounding_recipes")
    .update(next === "ready"
      ? { status: next, prepared_by: user?.id ?? null, prepared_at: new Date().toISOString() }
      : { status: next })
    .eq("id", recipeId);

  revalidatePath(`/klinik/racik/${recipeId}`);
  redirect(`/klinik/racik/${recipeId}?success=${next}`);
}

// §2 edge case: perubahan setelah diproses → void racikan lama (stok bahan dikembalikan), buat baru.
export async function voidRecipe(formData: FormData) {
  const supabase = await createClient();
  const recipeId = String(formData.get("recipeId") ?? "");
  const visitId = String(formData.get("visitId") ?? "");
  if (!recipeId) redirect(`/klinik/racik?error=${encodeURIComponent("Racikan tidak valid")}`);
  const params: ClinicVoidCompoundParams = { p_recipe_id: recipeId };
  const { error } = await supabase.rpc("clinic_void_compound", params);
  if (error) redirect(`${visitId ? `/klinik/rekam-medis/${visitId}` : `/klinik/racik/${recipeId}`}?error=${encodeURIComponent(parseClinicPostingError(error))}`);

  redirect(visitId ? `/klinik/rekam-medis/${visitId}?racikan=void` : `/klinik/racik?success=void`);
}
