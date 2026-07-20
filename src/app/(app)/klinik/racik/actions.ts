"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { nextStatus, stockDeductions, type RecipeStatus } from "@/lib/compounding";

// helper: gudang utama cabang (pola sama dgn checkout kasir).
async function branchWarehouse(supabase: Awaited<ReturnType<typeof createClient>>, branchId: string) {
  const { data: wh } = await supabase
    .from("warehouses").select("id").eq("branch_id", branchId).eq("is_active", true).order("type").limit(1).maybeSingle();
  return wh?.id ?? null;
}

async function adjustStock(supabase: Awaited<ReturnType<typeof createClient>>, warehouseId: string, itemId: string, delta: number) {
  const { data: st } = await supabase.from("stock").select("qty").eq("warehouse_id", warehouseId).eq("item_id", itemId).maybeSingle();
  if (st) {
    await supabase.from("stock").update({ qty: Number(st.qty) + delta, updated_at: new Date().toISOString() })
      .eq("warehouse_id", warehouseId).eq("item_id", itemId);
  }
}

// Tambah racikan inline dari view rekam medis (recorded) — field ringkas sama seperti
// tab Racikan di form pemeriksaan: nama, bentuk, aturan pakai, bahan+qty. total_volume &
// petunjuk racik dibiarkan kosong (nullable, §0044). Semantik tulis = jalur simpanRekamMedis.
export async function addRacikan(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const medicalRecordId = String(formData.get("medicalRecordId") ?? "");
  const visitId = String(formData.get("visitId") ?? "");
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

  const total = ings.reduce((a, b) => a + (Number(b.harga) || 0) * (Number(b.qty) || 0), 0);

  const { data: recipe, error: rErr } = await supabase
    .from("compounding_recipes")
    .insert({
      medical_record_id: medicalRecordId, recipe_name: recipeName,
      dosage_instruction: aturan, dosage_form: form, total_price: total,
      status: "pending", created_by: user?.id ?? null,
    })
    .select("id").single();
  if (rErr || !recipe) redirect(`${back}?error=${encodeURIComponent(rErr?.message ?? "Gagal simpan racikan")}`);

  const { error: iErr } = await supabase.from("compounding_ingredients").insert(
    ings.map((b) => ({
      recipe_id: recipe!.id, ingredient_name: b.nama, item_id: b.item_id,
      quantity: Number(b.qty), unit: b.satuan || "pcs", unit_price: Number(b.harga) || 0,
    })),
  );
  if (iErr) redirect(`${back}?error=${encodeURIComponent(iErr.message)}`);

  // §2: potong stok bahan di gudang cabang.
  const { data: visit } = await supabase.from("visits").select("branch_id").eq("id", visitId).maybeSingle();
  if (visit) {
    const whId = await branchWarehouse(supabase, visit.branch_id);
    if (whId) for (const d of stockDeductions(ings.map((b) => ({ item_id: b.item_id, quantity: Number(b.qty) })))) await adjustStock(supabase, whId, d.item_id, -d.qty);
  }

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

  const { data: r } = await supabase
    .from("compounding_recipes")
    .select("status, medical_record_id, compounding_ingredients(item_id, quantity)")
    .eq("id", recipeId).single();
  if (!r || r.status === "handed_over" || r.status === "void") {
    redirect(`/klinik/racik/${recipeId}?error=${encodeURIComponent("Racikan sudah diserahkan / sudah void")}`);
  }

  await supabase.from("compounding_recipes").update({ status: "void" }).eq("id", recipeId);

  // kembalikan stok bahan.
  const { data: mr } = await supabase.from("medical_records").select("visit_id").eq("id", r!.medical_record_id).maybeSingle();
  const { data: visit } = mr ? await supabase.from("visits").select("branch_id").eq("id", mr.visit_id).maybeSingle() : { data: null };
  if (visit) {
    const whId = await branchWarehouse(supabase, visit.branch_id);
    if (whId) {
      const ings = (r!.compounding_ingredients ?? []) as { item_id: string | null; quantity: number }[];
      for (const d of stockDeductions(ings)) await adjustStock(supabase, whId, d.item_id, +d.qty);
    }
  }

  redirect(visitId ? `/klinik/rekam-medis/${visitId}?racikan=void` : `/klinik/racik?success=void`);
}
