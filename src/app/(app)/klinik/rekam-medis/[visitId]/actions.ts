"use server";
import { servicePerformerInput, type ServicePerformersInput } from "@/lib/service-performers";
import { bmhpInput, type BmhpInput } from "@/lib/procedure-bmhp";
import { clinicPackageOriginInput, type ClinicPackageOrigin } from "@/lib/clinic-package-origin";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { alasanTarikValid, pesanTarikGagal, peranBolehTarik, PESAN_PERAN_TARIK, PESAN_AKSES_TARIK } from "@/lib/tarik-item";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseClinicPostingError, parseClinicRecordError, toClinicCompoundRecipeInput } from "@/lib/klinik-posting";
import { loadUnitOptions, pickUnit } from "@/lib/satuan";
import { bersihkanFollowUp, type FollowUpDraft } from "@/lib/followup";
import { hariIniWIB } from "@/lib/tanggal";
import { resolveDokter } from "@/lib/dokter";
import { pesanBeratTidakWajar } from "@/lib/anabul";
import { validateClinicalCompletion } from "@/lib/clinic-required-fields";

type RacikBahan = { item_id: string; nama: string; qty: number; satuan: string; harga: number };
type ResepItem = {
  service_performers?: ServicePerformersInput | null;
  bmhp?: BmhpInput[];
  nama_obat: string; qty: number; satuan?: string; harga?: number; aturan_pakai?: string; jenis?: string;
  kategori?: string; ingredients?: RacikBahan[]; dosage_form?: string;
  item_id?: string | null; faktor?: number; key?: string;
  official_version_id?: string;
  sale_item_id?: string;
};


/** Muatan `p_compounds` satu racikan baru — bentuk yang sama untuk item susulan dan Edit
 * rekam medis (keduanya berakhir di clinic_add_record_items). */
function compoundPayload(r: ResepItem) {
  return r.official_version_id
    ? {
        official_version_id: r.official_version_id,
        ...(r.sale_item_id ? { sale_item_id: r.sale_item_id } : {}),
        request_key: r.key ?? "",
        dosage_instruction: r.aturan_pakai ?? null,
        ...(r.service_performers != null ? { service_performers: servicePerformerInput(r.service_performers) } : {}),
      }
    : {
        request_key: r.key ?? "",
        ...(r.service_performers != null ? { service_performers: servicePerformerInput(r.service_performers) } : {}),
        ...(r.sale_item_id ? { sale_item_id: r.sale_item_id } : {}),
        recipe: toClinicCompoundRecipeInput({
          recipeName: r.nama_obat,
          dosageInstruction: r.aturan_pakai,
          dosageForm: r.dosage_form,
          ingredients: (r.ingredients ?? []).filter((b) => b.item_id && Number(b.qty) > 0),
        }),
      };
}
const racikanTanpaBahan = (r: ResepItem) => !r.official_version_id &&
  (r.ingredients ?? []).filter((b) => b.item_id && Number(b.qty) > 0).length === 0;

/** Penolakan dari peracikan (stok/bahan/HPP) diterjemahkan seperti form pemeriksaan supaya
 * popup "Stok tidak cukup" tetap muncul; penolakan Edit sendiri tetap apa adanya. */
const KODE_PERACIKAN = /^(STOCK_SHORT|LAYER_SHORT|INGREDIENT_INVALID|COST_MISSING|RECIPE_[A-Z_]+|UNIT_INVALID|ITEM_INVALID|WAREHOUSE_MISSING):/;
function pesanGagalEditLengkap(error: { code?: string; message: string }, adaRacikanBaru: boolean): string {
  if (error.message.startsWith("IDEMPOTENCY_CONFLICT: kunci edit rekam medis")) {
    return "Simpanan sebelumnya dengan isi berbeda sudah tercatat. Muat ulang halaman rekam medis untuk melihat data terbaru sebelum mengedit lagi.";
  }
  if (!adaRacikanBaru) return error.message;
  // Aplikasi sudah terpasang tapi fungsi database-nya belum: jangan tampilkan galat mentah.
  if (error.code === "PGRST202" || error.code === "42883") {
    return "Menambah racikan dari layar Edit belum aktif. Simpan dulu tanpa racikan, lalu tambahkan lewat tombol Tambah tindakan / obat.";
  }
  if (error.code === "P0001" && KODE_PERACIKAN.test(error.message)) return parseClinicPostingError(error, error.message);
  return error.message;
}

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
    const row = bersihkanFollowUp(r);
    return row ? [row] : [];
  });
}

export async function simpanRekamMedis(formData: FormData) {
  const supabase = await createClient();

  const visitId = String(formData.get("visitId") ?? "");
  const petId = String(formData.get("petId") ?? "");
  // Dokter dipilih dari daftar karyawan. Sebelumnya field ini dibaca dari form yang
  // tidak pernah mengirimnya, jadi setiap simpan rekam medis justru MENGHAPUS nama
  // dokter yang sudah diisi saat registrasi.
  const selectedDoctorId = String(formData.get("doctor_id") ?? "").trim() || null;
  const beratRaw = formData.get("berat");
  const berat = beratRaw ? Number(beratRaw) : null;
  const suhuRaw = formData.get("suhu");
  const suhu = suhuRaw ? Number(suhuRaw) : null;
  const keluhan = String(formData.get("keluhan") ?? "").trim() || null;
  const anamnesis = String(formData.get("anamnesis") ?? "") || null;
  const gejala_klinis = String(formData.get("gejala_klinis") ?? "") || null;
  const hasil_penunjang = String(formData.get("hasil_penunjang") ?? "") || null;
  const diagnosis = String(formData.get("diagnosis") ?? "") || null;
  const therapy = String(formData.get("therapy") ?? "").trim() || null;
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

  // Keranjang obat & jasa (POS) datang sebagai JSON dari form client.
  let resep: ResepItem[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("resep") ?? "[]"));
    resep = Array.isArray(parsed) ? parsed : [];
  } catch {
    resep = [];
  }
  // K02: BMHP is only sent once the database exposes the migrated contract;
  // older databases keep the exact previous payload instead of failing saves.
  let bmhpRows: (BmhpInput[] | null)[] = [];
  let bmhpError: string | null = null;
  let packageOrigins: ClinicPackageOrigin[] = [];
  let packageError: string | null = null;
  try { packageOrigins = resep.map(clinicPackageOriginInput); }
  catch (error) { packageError = error instanceof Error ? error.message : "Asal paket tidak valid"; }
  if (packageError) return redirect(`${back}?error=${encodeURIComponent(packageError)}`);
  // Tindakan jasa maupun persediaan (pekerjaan pesanan) sama-sama boleh membawa BMHP.
  try { bmhpRows = resep.map(r => r.item_id && r.jenis !== "racikan" ? bmhpInput(r.bmhp) : null); }
  catch (error) { bmhpError = error instanceof Error ? error.message : "BMHP tidak valid"; }
  const needsBmhp = bmhpRows.some(row => row?.length);

  // U07: semua bacaan sebelum simpan saling lepas — dulu dijalankan berurutan
  // (sampai 5 perjalanan ke database sebelum RPC simpan). Sekarang satu putaran.
  // Urutan pesan galat di bawah tetap sama seperti sebelumnya.
  const [
    { doctorId, nama: dokter },
    { data: clinicalVisit, error: clinicalVisitError },
    { data: pet },
    unitResult,
    bmhpSupport,
  ] = await Promise.all([
    resolveDokter(supabase, selectedDoctorId),
    supabase.from("visits").select("poli").eq("id", visitId).maybeSingle(),
    berat !== null
      ? supabase.from("pets").select("species").eq("id", petId).maybeSingle()
      : Promise.resolve({ data: null as { species: string | null } | null }),
    // Faktor satuan dibaca ulang dari master — angka dari form cuma menandai satuan mana
    // yang dipilih dokter, bukan sumber kebenaran konversi.
    loadUnitOptions(supabase, resep.map((r) => r.item_id).filter((x): x is string => !!x))
      .then((map) => ({ map, error: null as string | null }))
      .catch((error: unknown) => ({ map: null, error: error instanceof Error ? error.message : "Satuan barang belum dapat dibaca" })),
    needsBmhp && !bmhpError
      ? supabase.rpc("clinic_bmhp_supported").then(({ data }: { data: unknown }) => data === true)
      : Promise.resolve(false),
  ]);
  if (clinicalVisitError || !clinicalVisit) redirect(`${back}?error=${encodeURIComponent("Kunjungan tidak dapat dibaca. Muat ulang dan coba lagi.")}`);
  const clinicalError = validateClinicalCompletion(clinicalVisit.poli, doctorId, keluhan);
  if (clinicalError) redirect(`${back}?error=${encodeURIComponent(clinicalError)}`);
  if (berat !== null) {
    const pesanBerat = pesanBeratTidakWajar(pet?.species ?? null, berat);
    if (pesanBerat) redirect(`${back}?error=${encodeURIComponent(pesanBerat)}`);
  }
  const providerId = String(formData.get("provider_id") ?? "").trim() || null;
  const requestKey = String(formData.get("request_key") ?? "").trim();

  // Foto penunjang: path di bucket privat `medical-docs`, dikirim sbg JSON dari klien.
  let penunjangUrls: string[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("penunjang_urls") ?? "[]"));
    if (Array.isArray(parsed)) penunjangUrls = parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    penunjangUrls = [];
  }

  // Dulu galat master satuan lolos sebagai error mentah dan layar bilang "periksa
  // koneksi" padahal datanya tersimpan aman di draf — sekarang pesan yang jelas.
  if (unitResult.error || !unitResult.map) redirect(`${back}?error=${encodeURIComponent(unitResult.error ?? "Satuan barang belum dapat dibaca")}`);
  const unitOpts = unitResult.map;
  const faktorDari = (r: ResepItem) => {
    if (r.jenis === "racikan" || !r.item_id) return 1;
    const opts = unitOpts.get(r.item_id);
    return opts ? pickUnit(opts, r.satuan).factor : 1;
  };

  if (resep.some((r) => r.jenis === "racikan" && !r.official_version_id &&
    (r.ingredients ?? []).filter((b) => b.item_id && Number(b.qty) > 0).length === 0)) {
    redirect(`${back}?error=${encodeURIComponent("Setiap racikan harus memiliki minimal satu bahan")}`);
  }

  if (bmhpError) return redirect(`${back}?error=${encodeURIComponent(bmhpError)}`);
  if (needsBmhp && !bmhpSupport) {
    return redirect(`${back}?error=${encodeURIComponent("Pencatatan BMHP tindakan belum aktif di database. Hapus BMHP atau hubungi admin.")}`);
  }
  const rows = resep
    .map((r, index) => ({ r, bmhp: bmhpRows[index], origin: packageOrigins[index] }))
    .filter(({ r }) => r.nama_obat?.trim() && r.jenis !== "racikan")
    .map(({ r, bmhp, origin }) => ({
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
      ...(r.service_performers != null ? {service_performers: servicePerformerInput(r.service_performers)} : {}),
      // Kategori tindakan (§6.3) — dasar penentuan wajib/tidaknya form persetujuan.
      kategori: r.jenis === "jasa" ? (r.kategori?.trim() || null) : null,
      ...(bmhp?.length ? { bmhp_components: bmhp } : {}),
      ...origin,
    }));
  // Satu RPC untuk seluruh pemeriksaan. Gagal pada formula, stok, follow-up,
  // atau status kunjungan akan me-rollback semua baris, termasuk rekam medis.
  const racikan = resep.filter((r) => r.jenis === "racikan" &&
    (r.official_version_id || (r.ingredients ?? []).length > 0));
  const compounds = racikan.map((r) => r.official_version_id
    ? {
        official_version_id: r.official_version_id,
        ...(r.sale_item_id ? { sale_item_id: r.sale_item_id } : {}),
        request_key: r.key ?? "",
        dosage_instruction: r.aturan_pakai ?? null,
        ...(r.service_performers != null ? {service_performers: servicePerformerInput(r.service_performers)} : {}),
      }
    : {
        request_key: r.key ?? "",
        ...(r.service_performers != null ? {service_performers: servicePerformerInput(r.service_performers)} : {}),
        ...(r.sale_item_id ? { sale_item_id: r.sale_item_id } : {}),
        recipe: toClinicCompoundRecipeInput({
          recipeName: r.nama_obat,
          dosageInstruction: r.aturan_pakai,
          dosageForm: r.dosage_form,
          ingredients: (r.ingredients ?? []).filter((b) => b.item_id && Number(b.qty) > 0),
        }),
      });
  const { error: saveError } = await supabase.rpc("clinic_save_initial_record", {
    p_visit_id: visitId,
    p_pet_id: petId,
    p_record: {
      diagnosis, ...(therapy ? { therapy } : {}), anamnesis, suhu, berat, gejala_klinis, hasil_penunjang,
      follow_up, catatan_resep, penunjang_urls: penunjangUrls,
    },
    p_followups: followUps,
    p_rows: rows,
    p_compounds: compounds,
    p_provider_id: providerId,
    p_doctor_id: doctorId,
    p_dokter: dokter,
    p_keluhan: keluhan,
    p_request_key: requestKey,
  });
  if (saveError) redirect(`${back}?error=${encodeURIComponent(parseClinicRecordError(saveError))}`);
  revalidatePath(back);
  revalidatePath(`${back}/resep`);
  revalidatePath(`/klinik/pembayaran/${visitId}`);

  // Tujuan setelah simpan tergantung tombol yg dipencet.
  if (next === "resep") return { saved: true, href: `${back}/resep` };            // cetak resep
  if (next === "rawatinap") return { saved: true, href: `/klinik/pembayaran/${visitId}?rawatinap=1` };                   // DP dahulu; rencana/tipe dipilih eksplisit di Pembayaran
  return { saved: true, href: `/klinik/pembayaran/${visitId}` };                  // fallback
}

/**
 * Item susulan rawat jalan (Andri 29 Okt, opsi B): obat / jasa / tindakan / racikan yang
 * baru teringat SETELAH pemeriksaan disimpan tapi SEBELUM tagihan terbit. Muatannya
 * sama persis dengan keranjang form pemeriksaan, dan RPC-nya yang memeriksa peran,
 * cabang, keadaan kunjungan, dan kunci permintaan. Baris baru otomatis terbaca layar
 * Pembayaran karena dibaca dari rekam medis yang sama.
 */
export async function tambahItemRekamMedis(formData: FormData) {
  const supabase = await createClient();
  const visitId = String(formData.get("visitId") ?? "").trim();
  const requestKey = String(formData.get("request_key") ?? "").trim();
  const back = `/klinik/rekam-medis/${encodeURIComponent(visitId)}`;
  const form = `${back}/tambah-item`;
  if (!visitId || !requestKey || requestKey.length > 100) {
    redirect(`${form}?error=${encodeURIComponent("Muat ulang formulir lalu coba simpan lagi")}`);
  }

  let resep: ResepItem[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("resep") ?? "[]"));
    resep = Array.isArray(parsed) ? parsed : [];
  } catch {
    resep = [];
  }
  if (!resep.length) redirect(`${form}?error=${encodeURIComponent("Pilih minimal satu obat, jasa, tindakan, atau racikan")}`);

  // K02: BMHP hanya dikirim bila kontraknya sudah ada di database (pola simpanRekamMedis).
  let bmhpRows: (BmhpInput[] | null)[] = [];
  let bmhpError: string | null = null;
  let packageOrigins: ClinicPackageOrigin[] = [];
  let packageError: string | null = null;
  try { packageOrigins = resep.map(clinicPackageOriginInput); }
  catch (error) { packageError = error instanceof Error ? error.message : "Asal paket tidak valid"; }
  if (packageError) return redirect(`${form}?error=${encodeURIComponent(packageError)}`);
  try { bmhpRows = resep.map(r => r.item_id && r.jenis !== "racikan" ? bmhpInput(r.bmhp) : null); }
  catch (error) { bmhpError = error instanceof Error ? error.message : "BMHP tidak valid"; }
  const needsBmhp = !bmhpError && bmhpRows.some(row => row?.length);

  const [unitResult, bmhpSupport] = await Promise.all([
    // Faktor satuan dibaca ulang dari master; angka dari form hanya menandai pilihan satuan.
    loadUnitOptions(supabase, resep.map((r) => r.item_id).filter((x): x is string => !!x))
      .then((map) => ({ map, error: null as string | null }))
      .catch((error: unknown) => ({ map: null, error: error instanceof Error ? error.message : "Satuan barang belum dapat dibaca" })),
    needsBmhp
      ? supabase.rpc("clinic_bmhp_supported").then(({ data }: { data: unknown }) => data === true)
      : Promise.resolve(false),
  ]);
  if (bmhpError) redirect(`${form}?error=${encodeURIComponent(bmhpError)}`);
  if (needsBmhp && !bmhpSupport) {
    redirect(`${form}?error=${encodeURIComponent("Pencatatan BMHP tindakan belum aktif di database. Hapus BMHP atau hubungi admin.")}`);
  }
  if (unitResult.error || !unitResult.map) redirect(`${form}?error=${encodeURIComponent(unitResult.error ?? "Satuan barang belum dapat dibaca")}`);
  const unitOpts = unitResult.map;
  if (resep.some((r) => r.jenis === "racikan" && racikanTanpaBahan(r))) {
    redirect(`${form}?error=${encodeURIComponent("Setiap racikan harus memiliki minimal satu bahan")}`);
  }

  const items = resep
    .map((r, index) => ({ r, bmhp: bmhpRows[index], origin: packageOrigins[index] }))
    .filter(({ r }) => r.nama_obat?.trim() && r.jenis !== "racikan")
    .map(({ r, bmhp, origin }) => ({
      nama_obat: r.nama_obat.trim(),
      item_id: r.item_id ?? null,
      qty: Number(r.qty) > 0 ? Number(r.qty) : 1,
      satuan: r.satuan?.trim() || "pcs",
      faktor: !r.item_id ? 1 : (unitOpts.get(r.item_id) ? pickUnit(unitOpts.get(r.item_id)!, r.satuan).factor : 1),
      harga: Number(r.harga) > 0 ? Number(r.harga) : 0,
      aturan_pakai: r.aturan_pakai?.trim() || null,
      jenis: r.jenis === "jasa" ? "jasa" : "obat",
      ...(r.service_performers != null ? { service_performers: servicePerformerInput(r.service_performers) } : {}),
      kategori: r.jenis === "jasa" ? (r.kategori?.trim() || null) : null,
      ...(bmhp?.length ? { bmhp_components: bmhp } : {}),
      ...origin,
    }));
  const compounds = resep.filter((r) => r.jenis === "racikan" &&
    (r.official_version_id || (r.ingredients ?? []).length > 0)).map(compoundPayload);

  const { error } = await supabase.rpc("clinic_add_record_items", {
    p_visit_id: visitId,
    p_request_key: requestKey,
    p_items: items,
    p_compounds: compounds,
  });
  if (error) redirect(`${form}?error=${encodeURIComponent(parseClinicRecordError(error))}`);
  revalidatePath(back);
  revalidatePath(`${back}/resep`);
  revalidatePath(`${back}/dokumen`);
  revalidatePath(`/klinik/pembayaran/${visitId}`);
  revalidatePath("/klinik/racik");
  return { saved: true, href: `${back}?success=susulan` };
}

/** K01: billed records stay untouched; this only appends a diagnosis/therapy addendum. */
export async function tambahAdendumRekamMedis(formData: FormData) {
  const visitId = String(formData.get("visitId") ?? "").trim();
  const recordId = String(formData.get("medical_record_id") ?? "").trim();
  const back = `/klinik/rekam-medis/${encodeURIComponent(visitId)}`;
  const diagnosis = String(formData.get("diagnosis_addendum") ?? "").trim();
  const therapy = String(formData.get("therapy_addendum") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const requestKey = String(formData.get("draft_key") ?? "").trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(visitId) || !uuid.test(recordId) || !requestKey || requestKey.length > 100
    || (!diagnosis && !therapy) || diagnosis.length > 4000 || therapy.length > 4000 || reason.length > 1000) {
    redirect(`${back}?error=${encodeURIComponent("Isi adendum diagnosa atau terapi (maks. 4000 karakter).")}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("clinic_add_record_addendum", {
    p_visit_id: visitId,
    p_record_id: recordId,
    p_diagnosis: diagnosis || null,
    p_therapy: therapy || null,
    p_reason: reason || null,
    p_request_key: requestKey,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(parseClinicRecordError(error))}`);
  revalidatePath(back);
  revalidatePath(`${back}/dokumen`);
  redirect(`${back}?success=addendum${transactionDraftAck(formData)}`);
}

// Clinical corrections never call initial submission or accept billing/master fields.
export async function koreksiRekamMedis(formData: FormData) {
  const visitId = String(formData.get("visitId") ?? "");
  const recordId = String(formData.get("medical_record_id") ?? "");
  const back = `/klinik/rekam-medis/${encodeURIComponent(visitId)}`;
  const editable = `${back}?edit=${encodeURIComponent(recordId)}`;
  const revisionRaw = String(formData.get("expected_revision") ?? "");
  const revision = Number(revisionRaw);
  const reason = String(formData.get("correction_reason") ?? "").trim();
  const requestKey = String(formData.get("request_key") ?? "").trim();
  const temperatureRaw = String(formData.get("suhu") ?? "").trim();
  const suhu = temperatureRaw === "" ? null : Number(temperatureRaw);
  if (!visitId || !recordId || !/^\d+$/.test(revisionRaw) || !Number.isSafeInteger(revision)
    || reason.length < 3 || reason.length > 1000 || !requestKey || requestKey.length > 100
    || (suhu !== null && (!Number.isFinite(suhu) || suhu < 0 || suhu > 60 || Math.round(suhu * 100) / 100 !== suhu))) {
    redirect(`${editable}&error=${encodeURIComponent("Identitas, alasan koreksi, atau suhu tidak valid. Muat ulang dan periksa isian.")}`);
  }
  const text = (name: string) => String(formData.get(name) ?? "") || null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clinic_correct_unpaid_record", {
    p_visit_id: visitId, p_record_id: recordId, p_expected_revision: revision,
    p_changes: { anamnesis: text("anamnesis"), diagnosis: text("diagnosis"), therapy: text("therapy"),
      suhu, gejala_klinis: text("gejala_klinis"), hasil_penunjang: text("hasil_penunjang") },
    p_reason: reason, p_request_key: requestKey,
  });
  if (error || data !== recordId) redirect(`${editable}&error=${encodeURIComponent(error?.message ?? "Koreksi belum terkonfirmasi. Muat ulang sebelum mencoba lagi.")}`);
  for (const path of [back, `${back}/resep`, `${back}/dokumen`, "/klinik/rekam-medis", "/klinik/antrian",
    "/klinik/rawat-inap", "/klinik/racik", "/laporan/anamnesa"]) revalidatePath(path);
  return { saved: true, href: `${back}?success=correction` };
}

/** Full OWNER/DOCTOR edit; the database revalidates role, revision and billing state. */
export async function koreksiRekamMedisLengkap(formData: FormData) {
  const visitId = String(formData.get("visitId") ?? "");
  const recordId = String(formData.get("medical_record_id") ?? "");
  const back = `/klinik/rekam-medis/${encodeURIComponent(visitId)}`;
  const fail = (message: string): never => redirect(`${back}?edit=${encodeURIComponent(recordId)}&error=${encodeURIComponent(message)}`);
  const revisionRaw = String(formData.get("expected_revision") ?? "");
  const reason = String(formData.get("correction_reason") ?? "").trim();
  const requestKey = String(formData.get("request_key") ?? "");
  const rawTemperature = String(formData.get("suhu") ?? "").trim();
  const suhu = rawTemperature ? Number(rawTemperature) : null;
  if (!visitId || !recordId || !/^\d+$/.test(revisionRaw) || !Number.isSafeInteger(Number(revisionRaw)) || !requestKey || requestKey.length > 100
    || reason.length < 3 || reason.length > 1000 || (suhu !== null && (!Number.isFinite(suhu) || suhu < 0 || suhu > 60 || Math.round(suhu * 100) / 100 !== suhu))) fail("Identitas atau alasan koreksi tidak valid.");
  let rows;
  let compounds: ReturnType<typeof compoundPayload>[] = [];
  try {
    const raw: unknown = JSON.parse(String(formData.get("resep") ?? "[]"));
    if (!Array.isArray(raw) || raw.length > 200) throw Error("Keranjang tidak valid");
    const packageOrigins = new Map(raw.map(row => [row, clinicPackageOriginInput(row)]));
    // Racikan BARU (belum punya baris resep tersimpan) diracik lewat alur racik berjejak di
    // RPC pembungkus — bahan keluar saat itu juga. Racikan yang sudah dibuat tetap baris
    // tersimpan yang dikunci; koreksinya lewat Aksi racikan.
    const racikanBaru = (row: ResepItem & { prescription_item_id?: string | null; compound_recipe_id?: string | null }) =>
      row?.jenis === "racikan" && !row.prescription_item_id && !row.compound_recipe_id;
    const baru = raw.filter(racikanBaru);
    if (baru.length > 50) throw Error("Maksimal 50 racikan baru per simpan");
    if (baru.some(racikanTanpaBahan)) throw Error("Setiap racikan harus memiliki minimal satu bahan");
    compounds = baru.map(compoundPayload);
    rows = raw.filter((row) => !racikanBaru(row)).map((row) => ({
      prescription_item_id: row.prescription_item_id ?? null, item_id: row.item_id ?? null,
      nama_obat: row.nama_obat, qty: row.qty, harga: row.harga, satuan: row.satuan, jenis: row.jenis,
      kategori: row.kategori ?? null, aturan_pakai: row.aturan_pakai ?? null,
      compound_recipe_id: row.compound_recipe_id ?? null,
      bmhp_components: bmhpInput(row.bmhp), service_performers: row.service_performers ?? null,
      ...packageOrigins.get(row),
    }));
  } catch (error) { fail(error instanceof Error ? error.message : "Keranjang tidak valid"); }
  const text = (name: string) => String(formData.get(name) ?? "") || null;
  const supabase = await createClient();
  const args = {
    p_visit_id: visitId, p_record_id: recordId, p_expected_revision: Number(revisionRaw),
    p_changes: {anamnesis: text("anamnesis"), diagnosis: text("diagnosis"), therapy: text("therapy"), suhu,
      gejala_klinis: text("gejala_klinis"), hasil_penunjang: text("hasil_penunjang")},
    p_rows: rows, p_reason: reason, p_request_key: requestKey,
  };
  // Edit + racikan baru dalam satu transaksi database: stok bahan kurang membatalkan seluruh
  // simpanan. Pembungkus juga menyimpan sidik seluruh kiriman per kunci, jadi kiriman ulang
  // dengan isi berbeda (racikan dihapus sesudah respons hilang) ditolak, bukan "tersimpan".
  let { data, error } = await supabase.rpc("clinic_edit_queued_record_with_compounds", { ...args, p_compounds: compounds });
  // Fungsi baru belum terpasang di database: tanpa racikan baru, jalur lama persis masih aman.
  if (error?.code === "PGRST202" && !compounds.length) ({ data, error } = await supabase.rpc("clinic_edit_queued_record", args));
  if (error || data !== recordId) fail(error ? pesanGagalEditLengkap(error, compounds.length > 0) : "Koreksi belum terkonfirmasi. Muat ulang sebelum mencoba lagi.");  for (const path of [back, `${back}/resep`, `${back}/dokumen`, `/klinik/pembayaran/${visitId}`, "/klinik/rekam-medis", "/klinik/antrian", "/klinik/racik"]) revalidatePath(path);
  return {saved: true, href: `${back}?success=correction`};
}

/** "Tarik item": audited soft-withdraw of saved, not-yet-billed rows. Runs immediately (its own
 * transaction, not part of "Simpan"); the database revalidates role, invoice, racikan and package rules. */
export async function tarikItemRekamMedis(input: { visitId: string; recordId: string; itemIds: string[]; reason: string; requestKey: string }):
  Promise<{ ok: true; withdrawn: string[] } | { ok: false; error: string }> {
  const { visitId, recordId, itemIds, requestKey } = input ?? {};
  const reason = String(input?.reason ?? "").trim();
  if (!visitId || !recordId || !requestKey || requestKey.length > 100 || !Array.isArray(itemIds) || !itemIds.length || itemIds.length > 50) {
    return { ok: false, error: "Data penarikan tidak lengkap. Muat ulang halaman." };
  }
  if (!alasanTarikValid(reason)) return { ok: false, error: "Alasan penarikan wajib diisi 5-200 karakter dan minimal 5 huruf/angka (bukan hanya spasi atau tanda baca)." };
  const supabase = await createClient();
  // Lapis kedua (defense in depth): peran OWNER/DOKTER aktif + akses klinik cabang kunjungan, sama dengan gerbang database.
  // Database tetap pemutus akhir; pemeriksaan tak terbaca = ditolak.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi berakhir. Masuk lagi lalu ulangi penarikan." };
  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  if (!peranBolehTarik(profile)) return { ok: false, error: PESAN_PERAN_TARIK };
  const { data: akses, error: aksesError } = await supabase.rpc("clinic_record_correction_actor", { p_visit_id: visitId });
  if (aksesError || akses !== true) return { ok: false, error: PESAN_AKSES_TARIK };
  const { data, error } = await supabase.rpc("clinic_withdraw_record_items", {
    p_visit_id: visitId, p_record_id: recordId, p_item_ids: itemIds, p_reason: reason, p_request_key: requestKey,
  });
  if (error) return { ok: false, error: error.code === "PGRST202" ? "Fitur tarik item belum aktif di database." : pesanTarikGagal(error.message) };
  const withdrawn = (data as { withdrawn?: unknown } | null)?.withdrawn;
  if (!Array.isArray(withdrawn) || withdrawn.length !== itemIds.length) return { ok: false, error: pesanTarikGagal(null) };
  const back = `/klinik/rekam-medis/${encodeURIComponent(visitId)}`;
  for (const path of [back, `${back}/resep`, `${back}/dokumen`, `/klinik/pembayaran/${visitId}`, "/klinik/rekam-medis", "/klinik/antrian"]) revalidatePath(path);
  return { ok: true, withdrawn: withdrawn.map(String) };
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
  redirect(`/klinik/rekam-medis/${visitId}?success=referral${transactionDraftAck(formData)}`);
}

/**
 * Follow up susulan dari halaman detail rekam medis (masukan Babibu, 5 Nov): dokter bisa
 * menjadwalkan kontrol / vaksin berikutnya walau rekam medis sudah tersimpan atau tagihan
 * sudah lunas. Hanya menambah pengingat — tagihan, stok, dan isi rekam medis tidak berubah.
 * Akses cabang tetap dijaga RLS tabel follow_ups.
 */
export async function tambahFollowUpKunjungan(formData: FormData) {
  const visitId = String(formData.get("visit_id") ?? "").trim();
  const back = `/klinik/rekam-medis/${visitId}`;
  const gagal = (pesan: string): never => redirect(`${back}?error=${encodeURIComponent(pesan)}`);
  if (!visitId) redirect("/klinik/follow-up");
  const row = bersihkanFollowUp({
    jenis: formData.get("jenis"), tanggal: formData.get("tanggal"), catatan: formData.get("catatan"),
  });
  if (!row) gagal("Tanggal follow up belum diisi.");
  if (row!.tanggal < hariIniWIB()) gagal("Tanggal follow up tidak boleh sebelum hari ini.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: visit, error: visitError }, { data: record }] = await Promise.all([
    supabase.from("visits").select("id, pet_id, customer_id, branch_id, archived_at").eq("id", visitId).maybeSingle(),
    supabase.from("medical_records").select("id").eq("visit_id", visitId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (visitError || !visit) gagal("Kunjungan tidak ditemukan atau tidak dapat diakses.");
  if (visit!.archived_at) gagal("Kunjungan ini diarsipkan — follow up tidak dapat ditambahkan.");

  const { error } = await supabase.from("follow_ups").insert({
    visit_id: visitId, medical_record_id: record?.id ?? null, pet_id: visit!.pet_id,
    customer_id: visit!.customer_id, branch_id: visit!.branch_id,
    jenis: row!.jenis, tanggal: row!.tanggal, catatan: row!.catatan || null, created_by: user.id,
  });
  if (error) gagal(`Follow up belum tersimpan: ${error.message}`);
  revalidatePath("/klinik/follow-up");
  redirect(`${back}?success=followup${transactionDraftAck(formData)}`);
}
