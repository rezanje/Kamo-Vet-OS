"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type ResepItem = { nama_obat: string; qty: number; satuan?: string; harga?: number; aturan_pakai?: string; jenis?: string };

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

  if (!visitId) {
    redirect(`/klinik/antrian?error=${encodeURIComponent("Visit tidak valid")}`);
  }

  const back = `/klinik/rekam-medis/${visitId}`;

  const { data: mr, error: mrErr } = await supabase
    .from("medical_records")
    .insert({ visit_id: visitId, diagnosis, anamnesis, suhu, berat, gejala_klinis, hasil_penunjang, follow_up, catatan_resep })
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
      satuan: r.satuan?.trim() || "pcs",
      harga: Number(r.harga) > 0 ? Number(r.harga) : 0,
      aturan_pakai: r.aturan_pakai?.trim() || null,
      jenis: r.jenis === "jasa" ? "jasa" : "obat",
    }));
  if (rows.length) {
    const { error: piErr } = await supabase.from("prescription_items").insert(rows);
    if (piErr) {
      redirect(`${back}?error=${encodeURIComponent(piErr.message)}`);
    }
  }

  // berat terbaru ditarik ke kartu anabul (ponytail: single column, bukan time-series §1.2).
  if (petId && berat && berat > 0) {
    await supabase.from("pets").update({ weight: berat }).eq("id", petId);
  }

  // §3.4: rekam medis selesai → lanjut tahap Pembayaran. keluhan disinkron ke visit.
  await supabase.from("visits").update({ status: "Pembayaran", dokter, keluhan }).eq("id", visitId);

  redirect(`/klinik/pembayaran/${visitId}`);
}
