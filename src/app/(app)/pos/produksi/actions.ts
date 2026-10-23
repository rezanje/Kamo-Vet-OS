"use server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";
import type { BahanResep } from "@/lib/produksi";
import Decimal from "decimal.js";

import { loadUnitOptions, resolveSubmittedUnit, toBaseQty } from "@/lib/satuan";

const BASE = "/pos/produksi";


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Produksi menggeser nilai persediaan — dikunci ke peran yang boleh mengelola stok. */
async function assertBoleh(): Promise<Db> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`${BASE}?error=${encodeURIComponent("Hanya owner/admin yang bisa mengelola produksi")}`);
  }
  return supabase;
}

// ── Resep produksi ────────────────────────────────────────────────────────────
export async function simpanResep(formData: FormData) {
  const supabase = await assertBoleh();
  const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

  const itemId = String(formData.get("item_id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim();
  let outputQty = Number(formData.get("output_qty")) || 0;

  let bahan: (BahanResep & { satuan?: string })[] = [];
  try { bahan = JSON.parse(String(formData.get("bahan") ?? "[]")) as (BahanResep & { satuan?: string })[]; } catch { bahan = []; }
  bahan = bahan
    .map((b) => ({ item_id: String(b.item_id ?? ""), qty: Number(b.qty) || 0, satuan: b.satuan }))
    .filter((b) => b.item_id && b.qty > 0);

  if (!itemId) gagal("Pilih barang jadinya dulu");
  if (!nama) gagal("Nama resep wajib diisi");
  if (outputQty <= 0) gagal("Jumlah hasil per resep harus lebih dari 0");
  if (bahan.length === 0) gagal("Isi minimal satu bahan");
  // Barang jadi yang jadi bahannya sendiri = lingkaran tak berujung saat produksi.
  if (bahan.some((b) => b.item_id === itemId)) gagal("Barang jadi tidak boleh jadi bahannya sendiri");

  const ids = [...new Set([itemId, ...bahan.map(b => b.item_id)])];
  const [unitMap, masters] = await Promise.all([
    loadUnitOptions(supabase, ids),
    supabase.from("items").select("id, item_type").in("id", ids),
  ]);
  if (masters.error) throw new Error(masters.error.message);
  if ((masters.data ?? []).length !== ids.length || (masters.data ?? []).some((item: { item_type: string }) => item.item_type !== "Persediaan")) gagal("Resep produksi hanya memakai barang Persediaan.");
  const outputUnit = resolveSubmittedUnit(unitMap.get(itemId) ?? [], String(formData.get("output_unit") ?? ""));
  outputQty = toBaseQty(outputQty, outputUnit.factor);
  bahan = bahan.map(b => ({ item_id: b.item_id, qty: toBaseQty(b.qty, resolveSubmittedUnit(unitMap.get(b.item_id) ?? [], b.satuan).factor) }));
  if (!Number.isFinite(outputQty) || outputQty <= 0 || bahan.some(b => !Number.isFinite(b.qty) || b.qty <= 0)) gagal("Jumlah resep tidak valid.");


  const { data: { user } } = await supabase.auth.getUser();
  const { data: resep, error } = await supabase
    .from("production_recipes")
    .insert({ item_id: itemId, nama, output_qty: outputQty, created_by: user?.id ?? null })
    .select("id").single();
  if (error || !resep) gagal("Gagal menyimpan resep produksi");

  const { error: bErr } = await supabase.from("production_recipe_items").insert(
    bahan.map((b) => ({ recipe_id: resep!.id, item_id: b.item_id, qty: b.qty })),
  );
  if (bErr) {
    // Resep tanpa bahan tidak berarti apa-apa — jangan tinggalkan setengah jadi.
    await supabase.from("production_recipes").delete().eq("id", resep!.id);
    gagal("Gagal menyimpan bahan resep");
  }

  revalidatePath(BASE);
  redirect(`${BASE}?success=${encodeURIComponent(`Resep "${nama}" tersimpan.`)}`);
}

// New production financial effects are one database transaction per stage.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(message: string): never { return redirect(`${BASE}?error=${encodeURIComponent(message)}`); }
function quantity(raw: FormDataEntryValue | null): string {
  const text = String(raw ?? "").trim();
  try { const value = new Decimal(text); if (value.isFinite() && value.gt(0) && value.lte(1e9) && text.length <= 120) return text; } catch { /* report a validation error */ }
  return fail("Jumlah produksi harus positif dan valid.");
}
function requestKey(form: FormData): string {
  const key = String(form.get("request_key") ?? "");
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(key)) fail("Identitas simpan belum siap. Muat ulang dan periksa hasil terakhir sebelum menyimpan.");
  return key;
}
type Receipt = { order_id: string; no_produksi: string; kind: string; tanggal: string; value: number; journal_id: string | null; already_posted: boolean };
function receiptData(data: unknown, kind: string, expectedDate?: string, expectedOrder?: string): Receipt {
  const r = data as Receipt | null;
  if (!r || r.kind !== kind || !UUID.test(r.order_id) || typeof r.no_produksi !== "string" || !r.no_produksi.trim()
    || typeof r.tanggal !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.tanggal) || (expectedDate && r.tanggal !== expectedDate) || (expectedOrder && r.order_id !== expectedOrder) || typeof r.already_posted !== "boolean"
    || typeof r.value !== "number" || !Number.isFinite(r.value) || r.value < 0 || (r.journal_id !== null && !UUID.test(r.journal_id)) || (r.value>0 && !r.journal_id)) {
    fail("Hasil produksi belum dapat dipastikan. Periksa dokumen terakhir; tidak ada sukses yang dikonfirmasi.");
  }
  return r;
}
function confirmed(form: FormData, kind: string, key: string, r: Receipt): never {
  revalidatePath(BASE);
  const scope = kind === "start" ? "production-start" : `production-finish:${r.order_id}`;
  const message = `${r.no_produksi} ${kind === "start" ? "bahan keluar dan WIP" : "barang jadi dan WIP"} terkonfirmasi.${r.already_posted ? " Hasil asal dibuka; tidak ada posting ulang." : ""}`;
  return redirect(`${BASE}?success=${encodeURIComponent(message)}&request_scope=${encodeURIComponent(scope)}&request_done=${encodeURIComponent(key)}${transactionDraftAck(form)}`);
}
async function postProduction(form: FormData, kind: "start" | "finish", input: Record<string, unknown>) {
  const key = requestKey(form); const db = await createClient(); let result;
  try { result = await db.rpc("post_production_atomic", { p_kind: kind, p_request_key: key, p_input: input }); }
  catch { return fail("Posting produksi belum dapat dipastikan. Periksa hasil terakhir sebelum mencoba lagi."); }
  if (result.error) fail(["P0001","42501"].includes(result.error.code) ? result.error.message : "Posting produksi belum dapat dipastikan. Periksa hasil terakhir sebelum mencoba lagi.");
  return confirmed(form,kind,key,receiptData(result.data,kind,String(input[kind === "start" ? "tanggal" : "tanggal_selesai"]),kind === "finish" ? String(input.id) : undefined));
}
export async function mulaiProduksi(form: FormData) {
  const recipe = String(form.get("recipe_id") ?? ""); const warehouse = String(form.get("warehouse_id") ?? "");
  if (!UUID.test(recipe) || !UUID.test(warehouse)) fail("Pilih resep dan gudang produksi yang valid.");
  return postProduction(form,"start",{ recipe_id: recipe, warehouse_id: warehouse, batch: quantity(form.get("batch")), tanggal: String(form.get("tanggal") ?? "") || hariIniWIB(), catatan: String(form.get("catatan") ?? "").trim() || null });
}
export async function selesaikanProduksi(form: FormData) {
  const id = String(form.get("id") ?? ""); if (!UUID.test(id)) fail("Perintah produksi tidak valid.");
  return postProduction(form,"finish",{ id, qty_jadi: quantity(form.get("qty_jadi")), tanggal_selesai: String(form.get("tanggal_selesai") ?? "") || hariIniWIB() });
}
export async function recoverProductionPosting(form: FormData) {
  const kind = String(form.get("production_kind") ?? ""); const key = requestKey(form);
  const id = String(form.get("id") ?? "");
  if (!["start","finish"].includes(kind) || (kind === "finish" && !UUID.test(id))) fail("Permintaan pemeriksaan produksi tidak valid.");
  const db = await createClient(); let result;
  try { result = await db.rpc("get_production_atomic_result", { p_kind: kind, p_request_key: key, p_order_id: kind === "finish" ? id : null }); }
  catch { return fail("Hasil produksi belum dapat diperiksa. Tidak ada posting baru yang dijalankan."); }
  if (result.error) fail("Hasil produksi belum dapat diperiksa. Tidak ada posting baru yang dijalankan.");
  if (!result.data) fail("Belum ada hasil produksi yang terkonfirmasi untuk permintaan ini. Periksa daftar dan isian; tidak ada posting baru yang dijalankan.");
  return confirmed(form,kind,key,receiptData(result.data,kind,undefined,kind === "finish" ? id : undefined));
}
