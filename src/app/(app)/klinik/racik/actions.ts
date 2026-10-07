"use server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readCompleteList } from "@/lib/checked-list";
import { loadClinicCompoundSkus, loadClinicSkuDetails } from "@/lib/clinic-compound-skus";
import { nextStatus, type RecipeStatus } from "@/lib/compounding";

import { hargaCabang } from "@/lib/harga-cabang";
import { parseClinicPostingError, toClinicCompoundRecipeInput, type ClinicIssueCompoundParams, type ClinicVoidCompoundParams } from "@/lib/klinik-posting";
import { loadKatalogRacikan } from "@/lib/katalog-racikan-server";

export type BahanRacikan = { id: string; name: string; unit: string; sell_price: number; stok: number };

export async function katalogRacikanUntukKunjungan(visitId: string) {
  const supabase = await createClient();
  const { data: visit, error } = await supabase.from("visits")
    .select("id").eq("id", visitId).maybeSingle();
  if (error || !visit) throw new Error("Kunjungan tidak tersedia.");
  return loadKatalogRacikan();
}

export async function bahanRacikanUntukKunjungan(visitId: string): Promise<BahanRacikan[]> {
  const supabase = await createClient();
  const { data: visit, error } = await supabase.from("visits").select("branch_id").eq("id", visitId).maybeSingle();
  if (error || !visit) throw new Error("Kunjungan tidak tersedia.");
  const items = await readCompleteList<{id:string;name:string;unit:string;sell_price:number}>((from,to) => supabase.from("items")
    .select("id,name,unit,sell_price", {count:"exact"}).eq("is_active",true).eq("item_type","Persediaan").eq("is_compound_material",true)
    .order("name").order("id").range(from,to), "Bahan racikan");
  const {stock,prices} = await loadClinicSkuDetails(supabase,items.map(item=>item.id),visit.branch_id);
  return items.map(item=>({...item,sell_price:hargaCabang(prices,item.id,item.unit,Number(item.sell_price)),stok:stock.get(item.id)??0}));
}

export async function obatRacikUntukKunjungan(visitId:string) {
  const supabase=await createClient();
  const {data:visit,error}=await supabase.from("visits").select("branch_id").eq("id",visitId).maybeSingle();
  if(error||!visit)throw new Error("Kunjungan tidak tersedia.");
  const items=await loadClinicCompoundSkus(supabase);
  const {stock,prices}=await loadClinicSkuDetails(supabase,items.map(item=>item.id),visit.branch_id);
  return items.map(item=>({...item,sell_price:hargaCabang(prices,item.id,item.unit,Number(item.sell_price)),stok:stock.get(item.id)??0}));
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
  const officialVersionId = String(formData.get("official_version_id") ?? "").trim();
  const saleItemId = String(formData.get("sale_item_id") ?? "").trim();
  if (saleItemId) {
    let ingredients;
    try { ingredients = JSON.parse(String(formData.get("ingredients") ?? "[]")); }
    catch { return redirect(`${back}?error=${encodeURIComponent("Bahan racikan tidak valid")}`); }
    if (!Array.isArray(ingredients)) return redirect(`${back}?error=${encodeURIComponent("Bahan racikan tidak valid")}`);
    const {error} = await supabase.rpc("clinic_issue_master_compound", {
      p_medical_record_id:medicalRecordId, p_visit_id:visitId, p_sale_item_id:saleItemId,
      p_recipe:officialVersionId?null:toClinicCompoundRecipeInput({recipeName,dosageForm:form,dosageInstruction:aturan,ingredients}),
      p_request_key:requestKey,p_formula_version_id:officialVersionId||null,p_dosage_instruction:officialVersionId?aturan:null,
    });
    if(error)return redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(error))}`);
    revalidatePath(back);revalidatePath(`/klinik/pembayaran/${visitId}`);
    return redirect(`${back}?racikan=dibuat${transactionDraftAck(formData)}`);
  }
  if (officialVersionId) {
    if (!medicalRecordId || !visitId || !requestKey) return redirect(`${back}?error=${encodeURIComponent("Kunjungan racikan tidak valid")}`);
    const { error } = await supabase.rpc("clinic_issue_official_compound", {
      p_medical_record_id: medicalRecordId,
      p_visit_id: visitId,
      p_formula_version_id: officialVersionId,
      p_request_key: requestKey,
      p_dosage_instruction: aturan,
    });
    if (error) return redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(error))}`);
    return redirect(`${back}?racikan=dibuat${transactionDraftAck(formData)}`);
  }
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

  redirect(`/klinik/rekam-medis/${visitId}?racikan=dibuat${transactionDraftAck(formData)}`);
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
  redirect(`${back}?success=petunjuk${transactionDraftAck(formData)}`);
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
