"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { stockDeductions } from "@/lib/compounding";

type RacikBahan = { item_id: string; nama: string; qty: number; satuan: string; harga: number };
type ResepItem = {
  nama_obat: string; qty: number; satuan?: string; harga?: number; aturan_pakai?: string; jenis?: string;
  kategori?: string; ingredients?: RacikBahan[]; dosage_form?: string;
};

export async function simpanRekamMedis(formData: FormData) {
  const supabase = await createClient();

  const visitId = String(formData.get("visitId") ?? "");
  const petId = String(formData.get("petId") ?? "");
  const dokter = String(formData.get("dokter") ?? "").trim() || null;
  const beratRaw = formData.get("berat");
  const berat = beratRaw ? Number(beratRaw) : null;
  const suhuRaw = formData.get("suhu");
  const suhu = suhuRaw ? Number(suhuRaw) : null;
  const keluhan = String(formData.get("keluhan") ?? "").trim() || null;
  const anamnesis = String(formData.get("anamnesis") ?? "") || null;
  const gejala_klinis = String(formData.get("gejala_klinis") ?? "") || null;
  const hasil_penunjang = String(formData.get("hasil_penunjang") ?? "") || null;
  const diagnosis = String(formData.get("diagnosis") ?? "") || null;
  const follow_up = String(formData.get("follow_up") ?? "") || null;
  const catatan_resep = String(formData.get("catatan_resep") ?? "") || null;
  const next = String(formData.get("next") ?? "");

  if (!visitId) {
    redirect(`/klinik/antrian?error=${encodeURIComponent("Visit tidak valid")}`);
  }

  const back = `/klinik/rekam-medis/${visitId}`;

  // Foto penunjang: path di bucket privat `medical-docs`, dikirim sbg JSON dari klien.
  let penunjangUrls: string[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("penunjang_urls") ?? "[]"));
    if (Array.isArray(parsed)) penunjangUrls = parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    penunjangUrls = [];
  }

  const { data: mr, error: mrErr } = await supabase
    .from("medical_records")
    .insert({
      visit_id: visitId, diagnosis, anamnesis, suhu, berat, gejala_klinis, hasil_penunjang, follow_up, catatan_resep,
      penunjang_urls: penunjangUrls.length ? penunjangUrls : null,
    })
    .select("id").single();
  if (mrErr || !mr) {
    redirect(`${back}?error=${encodeURIComponent(mrErr?.message ?? "Gagal simpan rekam medis")}`);
  }

  // Keranjang obat & jasa (POS) datang sebagai JSON dari form client.
  let resep: ResepItem[] = [];
  try {
    resep = JSON.parse(String(formData.get("resep") ?? "[]"));
  } catch {
    resep = [];
  }
  const rows = resep
    .filter((r) => r.nama_obat?.trim())
    .map((r) => ({
      medical_record_id: mr!.id,
      nama_obat: r.nama_obat.trim(),
      qty: Number(r.qty) > 0 ? Number(r.qty) : 1,
      satuan: r.jenis === "racikan" ? "racikan" : (r.satuan?.trim() || "pcs"),
      harga: Number(r.harga) > 0 ? Number(r.harga) : 0,
      aturan_pakai: r.aturan_pakai?.trim() || null,
      // racikan ditagih sebagai baris "obat" (invoice/struk existing tak berubah, nama-only otomatis).
      jenis: r.jenis === "jasa" ? "jasa" : "obat",
      // Kategori tindakan (§6.3) — dasar penentuan wajib/tidaknya form persetujuan.
      kategori: r.jenis === "jasa" ? (r.kategori?.trim() || null) : null,
    }));
  if (rows.length) {
    const { error: piErr } = await supabase.from("prescription_items").insert(rows);
    if (piErr) {
      redirect(`${back}?error=${encodeURIComponent(piErr.message)}`);
    }
  }

  // Racikan → compounding_recipes (worklist apoteker) + BOM + potong stok bahan (spec §4).
  const racikan = resep.filter((r) => r.jenis === "racikan" && (r.ingredients ?? []).length > 0);
  if (racikan.length) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: visitRow } = await supabase.from("visits").select("branch_id").eq("id", visitId).maybeSingle();
    const { data: wh } = visitRow
      ? await supabase.from("warehouses").select("id").eq("branch_id", visitRow.branch_id).eq("is_active", true).order("type").limit(1).maybeSingle()
      : { data: null };

    for (const r of racikan) {
      const ings = (r.ingredients ?? []).filter((b) => b.item_id && Number(b.qty) > 0);
      if (ings.length === 0) continue;
      const total = ings.reduce((a, b) => a + (Number(b.harga) || 0) * (Number(b.qty) || 0), 0);

      const { data: recipe, error: recipeErr } = await supabase
        .from("compounding_recipes")
        .insert({
          medical_record_id: mr!.id, recipe_name: r.nama_obat.trim(),
          dosage_instruction: r.aturan_pakai?.trim() || null,
          dosage_form: r.dosage_form || null, total_price: total,
          status: "pending", created_by: user?.id ?? null,
        })
        .select("id").single();
      if (recipeErr || !recipe) {
        redirect(`${back}?error=${encodeURIComponent(recipeErr?.message ?? "Gagal simpan racikan")}`);
      }

      const { error: ingErr } = await supabase.from("compounding_ingredients").insert(
        ings.map((b) => ({
          recipe_id: recipe.id, ingredient_name: b.nama, item_id: b.item_id,
          quantity: Number(b.qty), unit: b.satuan || "pcs", unit_price: Number(b.harga) || 0,
        })),
      );
      if (ingErr) {
        redirect(`${back}?error=${encodeURIComponent(ingErr.message)}`);
      }

      // potong stok bahan di gudang cabang (pola createCompounding).
      if (wh) {
        for (const d of stockDeductions(ings.map((b) => ({ item_id: b.item_id, quantity: Number(b.qty) })))) {
          const { data: st } = await supabase.from("stock").select("qty").eq("warehouse_id", wh.id).eq("item_id", d.item_id).maybeSingle();
          if (st) await supabase.from("stock").update({ qty: Number(st.qty) - d.qty, updated_at: new Date().toISOString() }).eq("warehouse_id", wh.id).eq("item_id", d.item_id);
        }
      }
    }
  }

  // berat terbaru ditarik ke kartu anabul (ponytail: single column, bukan time-series §1.2).
  if (petId && berat && berat > 0) {
    await supabase.from("pets").update({ weight: berat }).eq("id", petId);
  }

  // §3.4: rekam medis selesai → lanjut tahap Pembayaran. keluhan disinkron ke visit.
  await supabase.from("visits").update({ status: "Pembayaran", dokter, keluhan }).eq("id", visitId);

  // Tujuan setelah simpan tergantung tombol yg dipencet.
  if (next === "resep") redirect(`${back}/resep`);            // cetak resep
  if (next === "rawatinap") redirect(back);                   // form admit rawat inap ada di view recorded
  redirect(`/klinik/pembayaran/${visitId}`);                  // fallback
}
