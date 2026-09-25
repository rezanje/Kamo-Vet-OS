"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseClinicPostingError, toClinicCompoundRecipeInput, type ClinicIssueCompoundParams } from "@/lib/klinik-posting";
import { loadUnitOptions, pickUnit } from "@/lib/satuan";
import { FOLLOWUP_JENIS } from "@/lib/followup";
import { resolveDokter } from "@/lib/dokter";
import { pesanBeratTidakWajar } from "@/lib/anabul";

type RacikBahan = { item_id: string; nama: string; qty: number; satuan: string; harga: number };
type ResepItem = {
  nama_obat: string; qty: number; satuan?: string; harga?: number; aturan_pakai?: string; jenis?: string;
  kategori?: string; ingredients?: RacikBahan[]; dosage_form?: string;
  item_id?: string | null; faktor?: number; key?: string;
  official_version_id?: string;
};

type FollowUpDraft = { jenis: string; tanggal: string; catatan: string };

// Baris follow up datang sbg JSON dari klien. Tanggal & jenis divalidasi di sini —
// jangan percaya nilai dari form, kolom `jenis` punya CHECK constraint di DB.
function parseFollowUps(raw: FormDataEntryValue | null): FollowUpDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? "[]"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((r) => {
    const row = r as Partial<FollowUpDraft>;
    const tanggal = String(row?.tanggal ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return [];
    const jenis = FOLLOWUP_JENIS.includes(row?.jenis as never) ? String(row!.jenis) : "Lainnya";
    return [{ jenis, tanggal, catatan: String(row?.catatan ?? "").trim() }];
  });
}

export async function simpanRekamMedis(formData: FormData) {
  const supabase = await createClient();

  const visitId = String(formData.get("visitId") ?? "");
  const petId = String(formData.get("petId") ?? "");
  // Dokter dipilih dari daftar karyawan. Sebelumnya field ini dibaca dari form yang
  // tidak pernah mengirimnya, jadi setiap simpan rekam medis justru MENGHAPUS nama
  // dokter yang sudah diisi saat registrasi.
  const { doctorId, nama: dokter } = await resolveDokter(supabase, String(formData.get("doctor_id") ?? "").trim() || null);
  const beratRaw = formData.get("berat");
  const berat = beratRaw ? Number(beratRaw) : null;
  const suhuRaw = formData.get("suhu");
  const suhu = suhuRaw ? Number(suhuRaw) : null;
  const keluhan = String(formData.get("keluhan") ?? "").trim() || null;
  const anamnesis = String(formData.get("anamnesis") ?? "") || null;
  const gejala_klinis = String(formData.get("gejala_klinis") ?? "") || null;
  const hasil_penunjang = String(formData.get("hasil_penunjang") ?? "") || null;
  const diagnosis = String(formData.get("diagnosis") ?? "") || null;
  // Ringkasan teks tetap diisi utk dokumen rekam medis cetak (kolom lama).
  const followUps = parseFollowUps(formData.get("follow_ups"));
  const follow_up = followUps.length
    ? followUps.map((f) => `${f.jenis} ${f.tanggal}${f.catatan ? ` — ${f.catatan}` : ""}`).join("; ")
    : null;
  const catatan_resep = String(formData.get("catatan_resep") ?? "") || null;
  const next = String(formData.get("next") ?? "");

  if (!visitId) {
    redirect(`/klinik/antrian?error=${encodeURIComponent("Visit tidak valid")}`);
  }

  const back = `/klinik/rekam-medis/${visitId}`;
  if (berat !== null) {
    const { data: pet } = await supabase.from("pets").select("species").eq("id", petId).maybeSingle();
    const pesanBerat = pesanBeratTidakWajar(pet?.species ?? null, berat);
    if (pesanBerat) redirect(`${back}?error=${encodeURIComponent(pesanBerat)}`);
  }
  const providerId = String(formData.get("provider_id") ?? "").trim();
  if (providerId) {
    const provider = await supabase.rpc("set_visit_service_state", {
      p_visit_id: visitId, p_action: "provider", p_provider_id: providerId,
    });
    if (provider.error) redirect(`${back}?error=${encodeURIComponent(provider.error.message)}`);
  }

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

  // Rencana follow up → worklist reminder pelanggan (/klinik/follow-up).
  if (followUps.length) {
    const { data: v } = await supabase
      .from("visits").select("branch_id, pets(customer_id)").eq("id", visitId).maybeSingle();
    const petRel = v?.pets as { customer_id: string | null } | { customer_id: string | null }[] | null;
    const customerId = (Array.isArray(petRel) ? petRel[0] : petRel)?.customer_id ?? null;
    const { data: { user } } = await supabase.auth.getUser();

    const { error: fuErr } = await supabase.from("follow_ups").insert(
      followUps.map((f) => ({
        visit_id: visitId, medical_record_id: mr!.id, pet_id: petId,
        customer_id: customerId, branch_id: v?.branch_id ?? null,
        jenis: f.jenis, tanggal: f.tanggal, catatan: f.catatan || null,
        created_by: user?.id ?? null,
      })),
    );
    if (fuErr) {
      redirect(`${back}?error=${encodeURIComponent(fuErr.message)}`);
    }
  }

  // Keranjang obat & jasa (POS) datang sebagai JSON dari form client.
  let resep: ResepItem[] = [];
  try {
    resep = JSON.parse(String(formData.get("resep") ?? "[]"));
  } catch {
    resep = [];
  }
  // Faktor satuan dibaca ulang dari master — angka dari form cuma menandai satuan mana
  // yang dipilih dokter, bukan sumber kebenaran konversi.
  const unitOpts = await loadUnitOptions(
    supabase,
    resep.map((r) => r.item_id).filter((x): x is string => !!x),
  );
  const faktorDari = (r: ResepItem) => {
    if (r.jenis === "racikan" || !r.item_id) return 1;
    const opts = unitOpts.get(r.item_id);
    return opts ? pickUnit(opts, r.satuan).factor : 1;
  };

  if (resep.some((r) => r.jenis === "racikan" && !r.official_version_id &&
    (r.ingredients ?? []).filter((b) => b.item_id && Number(b.qty) > 0).length === 0)) {
    redirect(`${back}?error=${encodeURIComponent("Setiap racikan harus memiliki minimal satu bahan")}`);
  }

  const rows = resep
    .filter((r) => r.nama_obat?.trim() && r.jenis !== "racikan")
    .map((r) => ({
      medical_record_id: mr!.id,
      nama_obat: r.nama_obat.trim(),
      // Tautan ke master barang (migrasi 0084) — tanpa ini stok obat klinik
      // tidak bisa dipotong dan modalnya tidak pernah tercatat.
      // Racikan sengaja NULL: stoknya sudah dipotong lewat bahan-bahannya.
      item_id: r.jenis === "racikan" ? null : (r.item_id ?? null),
      qty: Number(r.qty) > 0 ? Number(r.qty) : 1,
      satuan: r.jenis === "racikan" ? "racikan" : (r.satuan?.trim() || "pcs"),
      faktor: faktorDari(r),
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

  // Racikan, BOM, layer issue, HPP history, and stock move share one database transaction.
  const racikan = resep.filter((r) => r.jenis === "racikan" && (r.official_version_id || (r.ingredients ?? []).length > 0));
  if (racikan.length) {
    for (const r of racikan) {
      if (r.official_version_id) {
        const { error: officialError } = await supabase.rpc("clinic_issue_official_compound", {
          p_medical_record_id: mr!.id,
          p_visit_id: visitId,
          p_formula_version_id: r.official_version_id,
          p_request_key: r.key ?? "",
          p_dosage_instruction: r.aturan_pakai ?? null,
        });
        if (officialError) redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(officialError))}`);
        continue;
      }
      const ings = (r.ingredients ?? []).filter((b) => b.item_id && Number(b.qty) > 0);
      if (ings.length === 0) continue;
      const params: ClinicIssueCompoundParams = {
        p_medical_record_id: mr!.id,
        p_visit_id: visitId,
        p_recipe: toClinicCompoundRecipeInput({
          recipeName: r.nama_obat,
          dosageInstruction: r.aturan_pakai,
          dosageForm: r.dosage_form,
          ingredients: ings,
        }),
        p_request_key: r.key ?? "",
      };
      const { error: recipeErr } = await supabase.rpc("clinic_issue_compound", params);
      if (recipeErr) {
        redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(recipeErr))}`);
      }
    }
  }

  // berat terbaru ditarik ke kartu anabul (ponytail: single column, bukan time-series §1.2).
  if (petId && berat && berat > 0) {
    await supabase.from("pets").update({ weight: berat }).eq("id", petId);
  }

  // §3.4: rekam medis selesai → lanjut tahap Pembayaran. Waktu selesai dan audit
  // layanan dicatat bersama perubahan status lewat RPC.
  const finished = await supabase.rpc("set_visit_service_state", { p_visit_id: visitId, p_action: "finish" });
  if (finished.error) redirect(`${back}?error=${encodeURIComponent(finished.error.message)}`);
  const visitUpdated = await supabase.from("visits")
    .update({ status: "Pembayaran", dokter, doctor_id: doctorId, keluhan }).eq("id", visitId);
  if (visitUpdated.error) redirect(`${back}?error=${encodeURIComponent(visitUpdated.error.message)}`);

  // Tujuan setelah simpan tergantung tombol yg dipencet.
  if (next === "resep") redirect(`${back}/resep`);            // cetak resep
  if (next === "rawatinap") redirect(back);                   // form admit rawat inap ada di view recorded
  redirect(`/klinik/pembayaran/${visitId}`);                  // fallback
}

export async function createReferral(formData: FormData) {
  const supabase = await createClient();
  const visitId = String(formData.get("visit_id") ?? "").trim();
  const direction = String(formData.get("direction") ?? "").trim();
  const facility = String(formData.get("facility") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  if (!visitId || !["masuk", "keluar"].includes(direction) || !facility || !reason) {
    redirect(`/klinik/rekam-medis/${visitId}?error=${encodeURIComponent("Data referral belum lengkap")}`);
  }
  const { error } = await supabase.rpc("create_visit_referral", {
    p_visit_id: visitId,
    p_direction: direction,
    p_facility: facility,
    p_reason: reason,
    p_notes: notes || null,
  });
  if (error) redirect(`/klinik/rekam-medis/${visitId}?error=${encodeURIComponent(error.message)}`);
  redirect(`/klinik/rekam-medis/${visitId}?success=referral`);
}
