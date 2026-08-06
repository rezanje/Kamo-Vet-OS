"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseUnitDrafts } from "@/lib/satuan";
import { pickItemType, validasiBarang, pesanSimpanGagal } from "@/lib/barang";

const LIST = "/pos/sku";

async function assertBolehKelola() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") {
    redirect(`${LIST}?error=${encodeURIComponent("Hanya OWNER/ADMIN yang boleh mengubah master barang")}`);
  }
  return supabase;
}

export async function simpanBarang(formData: FormData) {
  const supabase = await assertBolehKelola();

  const id = String(formData.get("id") ?? "").trim();
  // Isian yang gagal disimpan dikembalikan ke formnya sendiri, bukan ke daftar.
  const back = id ? `${LIST}/${id}` : `${LIST}/baru`;
  const gagal = (msg: string) => redirect(`${back}?error=${encodeURIComponent(msg)}`);

  const draft = {
    name: String(formData.get("name") ?? "").trim(),
    code: String(formData.get("code") ?? "").trim(),
    categoryId: String(formData.get("category_id") ?? "").trim(),
    itemType: pickItemType(formData.get("item_type")),
    sellPrice: Number(formData.get("sell_price") ?? 0),
    buyPrice: Number(formData.get("buy_price") ?? 0),
    minStock: Number(formData.get("min_stock") ?? 0),
    tindakanKategori: String(formData.get("tindakan_kategori") ?? "").trim(),
  };

  const salah = validasiBarang(draft);
  if (salah) gagal(salah);

  const isJasa = draft.itemType === "Jasa";
  const unit = String(formData.get("unit") ?? "").trim() || (isJasa ? "tindakan" : "pcs");
  const upc = String(formData.get("upc") ?? "").trim();
  const brandId = String(formData.get("brand_id") ?? "").trim();

  // Satuan berjenjang: jasa tidak punya kemasan, sisanya divalidasi (faktor > 0, tanpa dobel).
  const { rows: unitRows, error: unitErr } = parseUnitDrafts(formData.get("units"), unit);
  if (unitErr) gagal(unitErr);
  const units = isJasa ? [] : unitRows;

  // Info pembelian & aturan jual (migrasi 0075). Diskon default dipagari 0–100:
  // constraint DB sudah ada, tapi angka liar dari form lebih enak ditolak di sini
  // daripada meledak jadi error Postgres mentah di layar admin.
  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  const buyUnit = String(formData.get("buy_unit") ?? "").trim();
  const substituteId = String(formData.get("substitute_item_id") ?? "").trim();
  const minBuy = Math.max(0, Number(formData.get("min_buy") ?? 0) || 0);
  const minSellQty = Math.max(0, Number(formData.get("min_sell_qty") ?? 0) || 0);
  const defaultDiscount = Math.min(100, Math.max(0, Number(formData.get("default_discount") ?? 0) || 0));

  const punyaStok = draft.itemType === "Persediaan";

  const patch = {
    name: draft.name,
    code: draft.code,
    category_id: draft.categoryId,
    item_type: draft.itemType,
    brand_id: brandId || null,
    upc: upc || null,
    unit,
    sell_price: draft.sellPrice,
    buy_price: draft.buyPrice,
    // Jasa & non-persediaan tidak dilacak stoknya — jangan simpan ambang yang tak dipakai.
    min_stock: punyaStok ? draft.minStock : 0,
    tindakan_kategori: isJasa ? draft.tindakanKategori : null,
    // Barang yang tidak punya stok tidak pernah dipesan ulang → info pembelian
    // & substitusinya dikosongkan supaya tidak muncul di usulan PO.
    supplier_id: punyaStok ? (supplierId || null) : null,
    buy_unit: punyaStok ? (buyUnit || null) : null,
    min_buy: punyaStok ? minBuy : 0,
    substitute_item_id: punyaStok && substituteId && substituteId !== id ? substituteId : null,
    min_sell_qty: minSellQty,
    default_discount: defaultDiscount,
    // Jasa & non-persediaan tidak pernah kadaluarsa — flagnya dipaksa mati supaya
    // tidak nyangkut kalau jenis barangnya diubah belakangan.
    track_expiry: punyaStok && String(formData.get("track_expiry") ?? "") === "1",
  };

  const { data: saved, error } = id
    ? await supabase.from("items").update(patch).eq("id", id).select("id").maybeSingle()
    : await supabase.from("items").insert({ ...patch, is_active: true }).select("id").maybeSingle();

  if (error) gagal(pesanSimpanGagal(error.message));

  // Replace-all: baris yang dihapus di form harus benar-benar hilang, kalau tidak
  // satuan lama tetap bisa dipilih di POS dgn faktor yang sudah tidak berlaku.
  const itemId = id || saved?.id;
  if (itemId) {
    await supabase.from("item_units").delete().eq("item_id", itemId);
    if (units.length) {
      const { error: uErr } = await supabase.from("item_units").insert(
        units.map((u) => ({ item_id: itemId, unit: u.unit, factor: u.factor, sell_price: u.sell_price, buy_price: u.buy_price })),
      );
      if (uErr) gagal(pesanSimpanGagal(uErr.message));
    }
  }

  redirect(`${LIST}?success=1`);
}

export async function toggleBarang(formData: FormData) {
  const supabase = await assertBolehKelola();
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${LIST}?error=${encodeURIComponent("Barang tidak valid")}`);

  const { error } = await supabase.from("items").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${LIST}?error=${encodeURIComponent(error.message)}` : `${LIST}?success=1`);
}
