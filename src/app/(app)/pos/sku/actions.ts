"use server";

import { changeMasterLifecycle } from "@/app/(app)/master-data/actions";
import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { bersihkanCacheSebentar } from "@/lib/cache-memori";
import { loadUnitOptions, parseUnitDrafts, resolveSubmittedUnit, replaceItemUnitConfiguration, unitOptions } from "@/lib/satuan";
import { rapikanTingkat } from "@/lib/harga-tingkat";
import { pickItemType, validasiBarang, validasiSatuanDasar, pesanSimpanGagal } from "@/lib/barang";
import {
  normalisasiKomponenGrup,
  parseKomponenGrupDrafts,
  type JenisKomponen,
  type KomponenGrupDraft,
} from "@/lib/grup-barang";

const LIST = "/pos/sku";

async function assertBolehKelola() { return assertMasterAdmin(LIST, "master data"); }

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
  const isGroup = draft.itemType === "Grup";
  const unit = String(formData.get("unit") ?? "").trim();
  const unitError = validasiSatuanDasar(unit);
  if (unitError) gagal(unitError);
  // Daftar satuan boleh memuat ejaan berbeda huruf besar/kecil (mis. "pcs" dan "PCS"):
  // ambil semuanya dan utamakan yang persis sama, jangan maybeSingle (dobel = gagal simpan).
  const { data: unitMaster, error: unitMasterError } = await supabase
    .from("units")
    .select("nama")
    .eq("is_active", true)
    .ilike("nama", unit);
  if (unitMasterError) gagal(pesanSimpanGagal(unitMasterError.message));
  // ilike memperlakukan "%" dan "_" sebagai pola; yang dipakai hanya nama yang benar-benar sama.
  const ejaanMaster = ((unitMaster ?? []) as { nama: string | null }[]).map((row) => String(row.nama ?? "").trim())
    .filter((nama) => nama && nama.toLowerCase() === unit.toLowerCase());
  let unitResmi = ejaanMaster.find((nama) => nama === unit) ?? ejaanMaster[0] ?? "";
  if (id) {
    const { data: lama, error: lamaError } = await supabase
      .from("items")
      .select("unit")
      .eq("id", id)
      .maybeSingle();
    if (lamaError) gagal(pesanSimpanGagal(lamaError.message));
    const unitLama = String(lama?.unit ?? "").trim();
    if (unitLama && unitLama.toLowerCase() === unit.toLowerCase()) {
      // Satuan dasar tidak berubah, hanya ejaannya beda dengan daftar satuan (barang impor
      // "PCS" vs daftar "pcs"). Pertahankan ejaan tersimpan: mengganti ejaan = mengubah satuan
      // dasar, yang ditolak database untuk SKU yang sudah pernah terjual, dan seluruh simpan
      // (termasuk perubahan harga) ikut gagal. Ini juga menjaga barang lama yang satuannya
      // sudah dinonaktifkan tetap bisa disimpan.
      unitResmi = unitLama;
    } else if (!ejaanMaster.length) {
      // Barang baru atau perubahan ke satuan nonaktif tetap ditolak.
      gagal("Satuan dasar belum terdaftar atau sudah nonaktif");
    }
  }
  if (!unitResmi) gagal("Satuan dasar belum terdaftar atau sudah nonaktif");
  const upc = String(formData.get("upc") ?? "").trim();
  const brandId = String(formData.get("brand_id") ?? "").trim();

  // Satuan berjenjang: jasa tidak punya kemasan, sisanya divalidasi (faktor > 0, tanpa dobel).
  const { rows: unitRows, error: unitErr } = parseUnitDrafts(formData.get("units"), unitResmi);
  if (unitErr) gagal(unitErr);
  const units = isJasa || isGroup ? [] : unitRows;

  // Faktor komponen dari browser diabaikan. Server memuat ulang satuan resmi setiap
  // komponen, lalu resep dinormalisasi sebelum item utama disentuh.
  let groupComponents: KomponenGrupDraft[] = [];
  if (isGroup) {
    const parsed = parseKomponenGrupDrafts(formData.get("group_components"));
    if (parsed.error) gagal(parsed.error);
    const componentIds = [...new Set(parsed.rows.map((row) => row.component_item_id).filter(Boolean))];
    const [{ data: componentItems }, optionMap] = await Promise.all([
      componentIds.length
        ? supabase.from("items").select("id, item_type, is_active").in("id", componentIds)
        : Promise.resolve({ data: [] }),
      loadUnitOptions(supabase, componentIds),
    ]);
    const masters = new Map(
      ((componentItems ?? []) as { id: string; item_type: JenisKomponen; is_active: boolean }[])
        .map((row) => [row.id, {
          item_type: row.item_type,
          is_active: row.is_active,
          units: (optionMap.get(row.id) ?? []).map((option) => ({
            unit: option.unit,
            factor: option.factor,
          })),
        }]),
    );
    const normalized = normalisasiKomponenGrup(parsed.rows, masters);
    if (normalized.error) gagal(normalized.error);
    groupComponents = normalized.rows;
  }

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
  if (punyaStok && buyUnit) {
    try { resolveSubmittedUnit(unitOptions({ unit: unitResmi, sell_price: draft.sellPrice, buy_price: draft.buyPrice }, units), buyUnit); }
    catch (error) { gagal(error instanceof Error ? error.message : "Satuan beli belum memiliki konversi barang."); }
  }


  const patch = {
    name: draft.name,
    code: draft.code,
    category_id: draft.categoryId,
    item_type: draft.itemType,
    brand_id: brandId || null,
    upc: upc || null,
    unit: unitResmi,
    sell_price: draft.sellPrice,
    buy_price: isGroup ? 0 : draft.buyPrice,
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

  // Reject sold conversion changes before unrelated master writes. Base and
  // alternate units change in one database transaction, including price-only edits.
  if (id) {
    let pesan = "";
    try { await replaceItemUnitConfiguration(supabase, id, unitResmi, units); }
    catch (error) { pesan = error instanceof Error ? error.message : "Satuan tidak dapat disimpan"; }
    if (pesan && (isJasa || isGroup)) {
      // Jasa/grup biasanya membuang baris kemasan sisa. Database menolaknya bila SKU sudah
      // pernah terjual (bukti historis), dan seluruh simpan — termasuk harga — ikut gagal.
      // Panggilan pertama satu transaksi utuh (tidak ada yang tertulis), jadi ulangi dengan
      // baris lama dibiarkan apa adanya. Perubahan satuan dasar yang sungguhan tetap ditolak.
      const { data: lamaUnits, error: lamaUnitsError } = await supabase
        .from("item_units")
        .select("unit, factor, sell_price, buy_price")
        .eq("item_id", id);
      if (lamaUnitsError) gagal(pesanSimpanGagal(lamaUnitsError.message));
      const tetap = ((lamaUnits ?? []) as { unit: string; factor: number; sell_price: number; buy_price: number | null }[])
        .filter((row) => row.unit && row.unit.toLowerCase() !== unitResmi.toLowerCase())
        .map((row) => ({ unit: row.unit, factor: Number(row.factor), sell_price: Number(row.sell_price) || 0, buy_price: Number(row.buy_price) || 0 }));
      pesan = "";
      try { await replaceItemUnitConfiguration(supabase, id, unitResmi, tetap); }
      catch (error) { pesan = error instanceof Error ? error.message : "Satuan tidak dapat disimpan"; }
    }
    if (pesan) gagal(pesanSimpanGagal(pesan));
  }

  const { data: saved, error } = id
    ? await supabase.from("items").update(patch).eq("id", id).select("id").maybeSingle()
    : await supabase.from("items").insert({ ...patch, is_active: true }).select("id").maybeSingle();

  if (error) gagal(pesanSimpanGagal(error.message));

  // Replace-all: baris yang dihapus di form harus benar-benar hilang, kalau tidak
  // satuan lama tetap bisa dipilih di POS dgn faktor yang sudah tidak berlaku.
  const itemId = id || saved?.id;
  if (itemId) {
    // Harga bertingkat ikut pola replace-all yang sama dengan satuan berjenjang:
    // tingkat yang dihapus di layar harus benar-benar hilang, kalau tidak kasir
    // masih bisa kena harga grosir yang sudah dicabut.
    let tiers: { min_qty: number; harga: number }[] = [];
    try { tiers = rapikanTingkat(JSON.parse(String(formData.get("tiers") ?? "[]"))); } catch { tiers = []; }
    await supabase.from("item_price_tiers").delete().eq("item_id", itemId);
    if (punyaStok && tiers.length) {
      const { error: tErr } = await supabase.from("item_price_tiers").insert(
        tiers.map((t) => ({ item_id: itemId, min_qty: t.min_qty, harga: t.harga })),
      );
      if (tErr) gagal(pesanSimpanGagal(tErr.message));
    }

    if (!id) {
      try { await replaceItemUnitConfiguration(supabase, itemId, unitResmi, units); }
      catch (error) { gagal(pesanSimpanGagal(error instanceof Error ? error.message : "Satuan tidak dapat disimpan")); }
    }

    // RPC = delete+insert satu transaksi. Jika insert resep baru ditolak trigger,
    // resep lama tidak ikut hilang. Payload kosong membersihkan resep saat jenis
    // diubah dari Grup menjadi jenis lain.
    const { error: groupErr } = await supabase.rpc("replace_item_group_components", {
      p_group_item_id: itemId,
      p_components: groupComponents.map((row, sortOrder) => ({
        ...row,
        sort_order: sortOrder,
      })),
    });
    if (groupErr) {
      if (!id && isGroup) {
        // Recoverable compensation; the former delete helper could cascade history.
        await supabase.rpc("change_master_data_lifecycle", {
          p_entity: "items", p_id: itemId, p_action: "trash", p_expected_revision: 0,
          p_reason: "Pembuatan resep grup gagal; master baru dikembalikan ke Sampah",
        });
      }
      gagal(pesanSimpanGagal(groupErr.message));
    }
  }

  // Katalog kasir/klinik disimpan sementara di memori (±2 menit); instance yang menyimpan
  // langsung membuang simpanannya supaya harga baru tidak menunggu kedaluwarsa di sini.
  bersihkanCacheSebentar();
  redirect(`${LIST}?success=1`);
}

export async function toggleBarang(formData: FormData) {
  formData.set("entity", "items");
  formData.set("action", formData.get("aktif") === "1" ? "archive" : "activate");
  return changeMasterLifecycle(formData);
}
