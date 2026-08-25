"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { stockIn, stockOut } from "@/lib/inventory";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { cekPeriode } from "@/lib/jurnal-guard";
import { hariIniWIB } from "@/lib/tanggal";
import { bahanKurang, hppPerUnit, kebutuhanBahan, rencanaJadi, type BahanResep } from "@/lib/produksi";

const BASE = "/pos/produksi";

const AKUN_PERSEDIAAN = "1301";
const AKUN_DALAM_PROSES = "1302";

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

async function nextNoProduksi(supabase: Db, tanggal: string): Promise<string> {
  // Tanggal dokumen dipakai apa adanya supaya nomor ikut bulan dokumennya,
  // bukan bulan server.
  const { nomor } = await nomorBerikutnya(supabase, "PRD", tanggal, {
    table: "production_orders", column: "no_produksi",
  });
  return nomor;
}

// ── Resep produksi ────────────────────────────────────────────────────────────
export async function simpanResep(formData: FormData) {
  const supabase = await assertBoleh();
  const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

  const itemId = String(formData.get("item_id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim();
  const outputQty = Number(formData.get("output_qty")) || 0;

  let bahan: BahanResep[] = [];
  try { bahan = JSON.parse(String(formData.get("bahan") ?? "[]")) as BahanResep[]; } catch { bahan = []; }
  bahan = bahan
    .map((b) => ({ item_id: String(b.item_id ?? ""), qty: Number(b.qty) || 0 }))
    .filter((b) => b.item_id && b.qty > 0);

  if (!itemId) gagal("Pilih barang jadinya dulu");
  if (!nama) gagal("Nama resep wajib diisi");
  if (outputQty <= 0) gagal("Jumlah hasil per resep harus lebih dari 0");
  if (bahan.length === 0) gagal("Isi minimal satu bahan");
  // Barang jadi yang jadi bahannya sendiri = lingkaran tak berujung saat produksi.
  if (bahan.some((b) => b.item_id === itemId)) gagal("Barang jadi tidak boleh jadi bahannya sendiri");

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

// ── Perintah produksi: bahan KELUAR di sini ───────────────────────────────────
export async function mulaiProduksi(formData: FormData) {
  const supabase = await assertBoleh();
  const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

  const recipeId = String(formData.get("recipe_id") ?? "").trim();
  const warehouseId = String(formData.get("warehouse_id") ?? "").trim();
  const batch = Number(formData.get("batch")) || 0;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  if (!recipeId) gagal("Pilih resep produksinya");
  if (!warehouseId) gagal("Pilih gudang tempat bahan diambil");
  if (batch <= 0) gagal("Jumlah batch harus lebih dari 0");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  const { data: resep } = await supabase
    .from("production_recipes")
    .select("id, nama, output_qty, item_id, production_recipe_items(item_id, qty, items(name))")
    .eq("id", recipeId).maybeSingle();
  if (!resep) gagal("Resep tidak ditemukan");

  type BahanRow = { item_id: string; qty: number; items: { name: string } | { name: string }[] | null };
  const bahanResep: BahanResep[] = ((resep!.production_recipe_items ?? []) as unknown as BahanRow[]).map((b) => {
    const it = Array.isArray(b.items) ? b.items[0] : b.items;
    return { item_id: b.item_id, nama: it?.name ?? "Bahan", qty: Number(b.qty) };
  });
  if (bahanResep.length === 0) gagal("Resep ini belum punya bahan");

  const kebutuhan = kebutuhanBahan(bahanResep, batch);

  // Stok dicek DULU: bahan yang keluar sebagian lalu berhenti di tengah
  // meninggalkan nilai yang menggantung tanpa barang jadi.
  const { data: stokRows } = await supabase
    .from("stock").select("item_id, qty")
    .eq("warehouse_id", warehouseId)
    .in("item_id", kebutuhan.map((k) => k.item_id));
  const stok = new Map(((stokRows ?? []) as { item_id: string; qty: number }[]).map((s) => [s.item_id, Number(s.qty)]));
  const kurang = bahanKurang(kebutuhan, stok);
  if (kurang.length > 0) {
    gagal(`Stok bahan tidak cukup: ${kurang.map((k) => `${k.nama ?? k.item_id} (butuh ${k.butuh}, ada ${k.ada})`).join(", ")}`);
  }

  const { data: { user } } = await supabase.auth.getUser();
  const no = await nextNoProduksi(supabase, tanggal);
  const { data: doc, error } = await supabase
    .from("production_orders")
    .insert({
      no_produksi: no, recipe_id: recipeId, warehouse_id: warehouseId, batch,
      tanggal, catatan, created_by: user?.id ?? null,
    })
    .select("id").single();
  if (error || !doc) gagal("Gagal membuat perintah produksi");

  let nilaiBahan = 0;
  for (const k of kebutuhan) {
    const { cost } = await stockOut(supabase, {
      warehouseId, itemId: k.item_id, qty: k.qty, source: "produksi", ref: no,
    });
    nilaiBahan += cost;
    await supabase.from("production_order_items").insert({
      order_id: doc!.id, item_id: k.item_id, nama: k.nama ?? "Bahan", qty: k.qty, hpp: cost,
    });
  }

  await supabase.from("production_orders").update({ nilai_bahan: nilaiBahan }).eq("id", doc!.id);

  // Nilainya pindah dari Persediaan ke Persediaan Dalam Proses — bukan hilang.
  if (nilaiBahan > 0) {
    await postJournal(supabase, {
      tanggal,
      deskripsi: `Bahan keluar produksi ${no} (${resep!.nama})`,
      source: "produksi",
      sourceRef: no,
      lines: [
        { code: AKUN_DALAM_PROSES, debit: nilaiBahan, credit: 0 },
        { code: AKUN_PERSEDIAAN, debit: 0, credit: nilaiBahan },
      ],
    });
  }

  revalidatePath(BASE);
  redirect(`${BASE}?success=${encodeURIComponent(`Produksi ${no} berjalan — bahan sudah keluar gudang. Rencana jadi ${rencanaJadi(Number(resep!.output_qty), batch)}.`)}`);
}

// ── Penyelesaian: barang jadi MASUK ───────────────────────────────────────────
export async function selesaikanProduksi(formData: FormData) {
  const supabase = await assertBoleh();
  const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

  const id = String(formData.get("id") ?? "").trim();
  const qtyJadi = Number(formData.get("qty_jadi")) || 0;
  const tanggal = String(formData.get("tanggal_selesai") ?? "").trim() || hariIniWIB();

  if (!id) gagal("Perintah produksi tidak dikenali");
  if (qtyJadi <= 0) gagal("Jumlah barang jadi harus lebih dari 0");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  const { data: doc } = await supabase
    .from("production_orders")
    .select("id, no_produksi, status, warehouse_id, nilai_bahan, production_recipes(nama, item_id)")
    .eq("id", id).maybeSingle();
  if (!doc) gagal("Perintah produksi tidak ditemukan");
  if (doc!.status !== "berjalan") gagal("Perintah ini sudah selesai atau dibatalkan");

  const rel = doc!.production_recipes as { nama: string; item_id: string } | { nama: string; item_id: string }[] | null;
  const resep = Array.isArray(rel) ? rel[0] : rel;
  if (!resep) gagal("Resep perintah ini sudah tidak ada");

  const nilaiBahan = Number(doc!.nilai_bahan) || 0;
  const hpp = hppPerUnit(nilaiBahan, qtyJadi);

  await stockIn(supabase, {
    warehouseId: doc!.warehouse_id, itemId: resep!.item_id, qty: qtyJadi,
    unitCost: hpp, source: "produksi", ref: doc!.no_produksi, tanggal,
  });

  await supabase.from("production_orders").update({
    status: "selesai", qty_jadi: qtyJadi, tanggal_selesai: tanggal,
  }).eq("id", id);

  // Nilai kembali dari Dalam Proses ke Persediaan, sekarang menempel di barang jadi.
  if (nilaiBahan > 0) {
    await postJournal(supabase, {
      tanggal,
      deskripsi: `Barang jadi masuk produksi ${doc!.no_produksi} (${resep!.nama})`,
      source: "produksi",
      sourceRef: doc!.no_produksi,
      lines: [
        { code: AKUN_PERSEDIAAN, debit: nilaiBahan, credit: 0 },
        { code: AKUN_DALAM_PROSES, debit: 0, credit: nilaiBahan },
      ],
    });
  }

  revalidatePath(BASE);
  redirect(`${BASE}?success=${encodeURIComponent(
    `Produksi ${doc!.no_produksi} selesai — ${qtyJadi} barang jadi masuk stok, harga pokok ${Math.round(hpp).toLocaleString("id-ID")}/unit.`,
  )}`);
}
