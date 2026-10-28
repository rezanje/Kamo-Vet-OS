"use server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readCompleteList } from "@/lib/checked-list";
import { loadClinicCompoundSkus, loadClinicSkuDetails } from "@/lib/clinic-compound-skus";
import { nextStatus, type RecipeStatus } from "@/lib/compounding";

import { hargaCabang } from "@/lib/harga-cabang";
import { parseClinicPostingError, toClinicCompoundRecipeInput, type ClinicIssueCompoundParams } from "@/lib/klinik-posting";
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

  // The issue RPC locks the visit and rejects new work after invoice. Let exact
  // request-key retries reach it so a lost response can still be acknowledged.

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

// Recipient usage is separate from technical steps; never infer it from legacy text.
export async function updateRacikPemakaian(formData: FormData) {
  const recipeId = String(formData.get("recipeId") ?? "");
  const back = `/klinik/racik/${recipeId}`;
  if (!recipeId) redirect(`/klinik/racik?error=${encodeURIComponent("Racikan tidak valid")}`);
  if (!formData.has("dosage_instruction")) redirect(`${back}?error=${encodeURIComponent("Petunjuk pemakaian tidak terkirim. Muat ulang halaman.")}`);
  const supabase = await createClient();
  const { data, error } = await supabase.from("compounding_recipes")
    .update({
      dosage_instruction: String(formData.get("dosage_instruction") ?? "").trim() || null,
      total_volume: String(formData.get("total_volume") ?? "").trim() || null,
    })
    .eq("id", recipeId).in("status", ["pending", "ready"]).select("id").maybeSingle();
  if (error) {
    const message = error.code === "P0001" && error.message.startsWith("USAGE_LINK_MISSING:")
      ? "Petunjuk pemakaian belum disimpan karena resep belum tertaut atau tidak dapat diakses. Minta dokter meninjau resep."
      : error.code === "P0001" && error.message.startsWith("RECIPE_LINKED:")
        ? "Petunjuk pemakaian resep resmi tidak dapat diubah di sini."
        : parseClinicPostingError(error, "Petunjuk pemakaian belum tersimpan. Periksa resep lalu coba lagi.");
    redirect(`${back}?error=${encodeURIComponent(message)}`);
  }
  if (!data) redirect(`${back}?error=${encodeURIComponent("Racikan tidak tersedia atau sudah diserahkan / void — tidak bisa diubah")}`);
  revalidatePath(back);
  revalidatePath("/klinik/rekam-medis", "layout");
  revalidatePath("/klinik/rawat-inap", "layout");
  redirect(`${back}?success=pemakaian${transactionDraftAck(formData)}`);
}

// Internal technical steps remain separate; quantity is owned by the main form.
export async function updateRacikPetunjuk(formData: FormData) {
  const supabase = await createClient();
  const recipeId = String(formData.get("recipeId") ?? "");
  const steps = String(formData.get("compounding_steps") ?? "").trim() || null;
  const back = `/klinik/racik/${recipeId}`;
  if (!recipeId) redirect(`/klinik/racik?error=${encodeURIComponent("Racikan tidak valid")}`);

  const { data, error } = await supabase
    .from("compounding_recipes")
    .update({ compounding_steps: steps })
    .eq("id", recipeId).in("status", ["pending", "ready"]).select("id").maybeSingle();
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  if (!data) redirect(`${back}?error=${encodeURIComponent("Racikan tidak tersedia atau sudah diserahkan / void — tidak bisa diubah")}`);

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

// Alasan wajib untuk kedua aksi racikan; database menolak alasan kosong juga.
function alasanRacikan(formData: FormData): string | null {
  const reason = String(formData.get("reason") ?? "").trim();
  return reason.length >= 3 && reason.length <= 500 ? reason : null;
}

/** Ubah komposisi racikan: hanya selisih jumlahnya yang menggerakkan stok bahan.
 * Syarat (belum diserahkan, tagihan belum dibayar) ditegakkan ulang di database. */
export async function ubahKomposisiRacikan(formData: FormData) {
  const recipeId = String(formData.get("recipeId") ?? "");
  const visitId = String(formData.get("visitId") ?? "");
  const back = `/klinik/racik/${recipeId}`;
  if (!recipeId) redirect(`/klinik/racik?error=${encodeURIComponent("Racikan tidak valid")}`);
  const reason = alasanRacikan(formData);
  if (!reason) redirect(`${back}?error=${encodeURIComponent("Alasan perubahan komposisi wajib diisi (3–500 karakter)")}`);

  let bahan: unknown;
  try { bahan = JSON.parse(String(formData.get("ingredients") ?? "[]")); }
  catch { return redirect(`${back}?error=${encodeURIComponent("Komposisi racikan tidak valid")}`); }
  const rows = Array.isArray(bahan) ? bahan.map(raw => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return { item_id: typeof row.item_id === "string" ? row.item_id.trim() : "", quantity: Number(row.quantity) };
  }) : [];
  if (!rows.length || rows.length > 100
    || rows.some(row => !row.item_id || !Number.isFinite(row.quantity) || row.quantity <= 0)
    || new Set(rows.map(row => row.item_id)).size !== rows.length) {
    redirect(`${back}?error=${encodeURIComponent("Komposisi racikan tidak valid: periksa bahan dan jumlahnya")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("clinic_adjust_compound", {
    p_recipe_id: recipeId, p_ingredients: rows, p_reason: reason,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(error))}`);
  revalidatePath(back);
  if (visitId) { revalidatePath(`/klinik/rekam-medis/${visitId}`); revalidatePath(`/klinik/pembayaran/${visitId}`); }
  redirect(`${back}?success=komposisi${transactionDraftAck(formData)}`);
}

/** §2 edge case: perubahan setelah diproses → bahan dikembalikan ke stok pada harga pokok
 * saat diambil, racikan ditandai void dan tetap tersimpan, lalu racikan baru dibuat. */
export async function kembalikanBahanRacikan(formData: FormData) {
  const recipeId = String(formData.get("recipeId") ?? "");
  const visitId = String(formData.get("visitId") ?? "");
  const back = `/klinik/racik/${recipeId}`;
  if (!recipeId) redirect(`/klinik/racik?error=${encodeURIComponent("Racikan tidak valid")}`);
  const reason = alasanRacikan(formData);
  if (!reason) redirect(`${back}?error=${encodeURIComponent("Alasan pengembalian bahan wajib diisi (3–500 karakter)")}`);

  const supabase = await createClient();
  const { error } = await supabase.rpc("clinic_return_compound", { p_recipe_id: recipeId, p_reason: reason });
  if (error) redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(error))}`);
  revalidatePath(back);
  if (visitId) { revalidatePath(`/klinik/rekam-medis/${visitId}`); revalidatePath(`/klinik/pembayaran/${visitId}`); }
  redirect(visitId ? `/klinik/rekam-medis/${visitId}?racikan=kembali` : `/klinik/racik?success=kembali`);
}
