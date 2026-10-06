"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { nilaiPantauUntukDatabase } from "@/lib/monitoring-inap";
import { canTransition, ripWaMessage, type Condition, type Role } from "@/lib/inpatient";
import { parseClinicRecordError, toClinicCompoundRecipeInput } from "@/lib/klinik-posting";
import { loadUnitOptions, pickUnit } from "@/lib/satuan";
import { sendWA } from "@/lib/fonnte";
import { hariIniWIB, waktuInputWIB } from "@/lib/tanggal";
import { inpatientStaffInput } from '@/lib/clinical-staff';

function bacaPetugas(formData:FormData,back:string,allowLegacy=false) {
  try{return formData.has('log_kind')?inpatientStaffInput(formData,allowLegacy):{};}
  catch(error){redirect(`${back}?error=${encodeURIComponent(error instanceof Error?error.message:'Pilih petugas yang valid')}`);}
}

// Admit pasien rawat inap dari rekam medis (popup design klinik/07).
export async function admitInpatient(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const visitId = String(formData.get("visitId") ?? "");
  const treatmentPlan = String(formData.get("treatment_plan") ?? "").trim();
  const doctorName = String(formData.get("doctor_name") ?? "").trim();
  const back = `/klinik/rekam-medis/${visitId}`;
  if (!visitId || !treatmentPlan) redirect(`${back}?error=${encodeURIComponent("Isi rencana tindakan rawat inap")}`);

  const { data: visit } = await supabase.from("visits").select("branch_id, dokter").eq("id", visitId).maybeSingle();
  if (!visit) redirect(`${back}?error=${encodeURIComponent("Kunjungan tidak ditemukan")}`);

  const { data: mr } = await supabase
    .from("medical_records").select("id").eq("visit_id", visitId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const { data: rec, error } = await supabase
    .from("inpatient_records")
    .insert({
      branch_id: visit!.branch_id, visit_id: visitId, medical_record_id: mr?.id ?? null,
      doctor_name: doctorName || visit!.dokter || null, treatment_plan: treatmentPlan,
      created_by: user?.id ?? null,
    })
    .select("id").single();
  if (error || !rec) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Gagal admit rawat inap")}`);

  await supabase.from("inpatient_status_log").insert({
    inpatient_record_id: rec!.id, previous_status: null, new_status: "stabil",
    changed_by: user?.id ?? null, notes: "Admit rawat inap",
  });

  redirect(`/klinik/rawat-inap/${rec!.id}?success=admit`);
}

// Kolom pemantauan harian (migrasi 0106). Kosong disimpan sebagai NULL — "belum
// diperiksa" tidak boleh berubah jadi angka atau jadi "tidak ada", karena hitungan
// hari tanpa BAB & grafik berat dibaca langsung dari sini.
function bacaPemantauan(formData: FormData) {
  const teks = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v || null;
  };
  const angka = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    makan: nilaiPantauUntukDatabase("makan", teks("makan")),
    minum: nilaiPantauUntukDatabase("minum", teks("minum")),
    bab: nilaiPantauUntukDatabase("bab", teks("bab")),
    pipis: nilaiPantauUntukDatabase("pipis", teks("pipis")),
    berat: angka("berat"), suhu: angka("suhu"), foto_url: teks("foto_url"),
    komunikasi_owner: teks("komunikasi_owner"), komunikasi_via: teks("komunikasi_via"),
  };
}

// Laporan harian — append-only (§3 dashboard req): entry baru, tidak pernah overwrite.
export async function addDailyLog(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const recordId = String(formData.get("recordId") ?? "");
  const conditionNote = String(formData.get("condition_note") ?? "").trim();
  const tindakan = String(formData.get("tindakan") ?? "").trim() || null;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;
  const doctorName = String(formData.get("doctor_name") ?? "").trim() || null;
  const back = `/klinik/rawat-inap/${recordId}`;
  if (!recordId || !conditionNote) redirect(`${back}?error=${encodeURIComponent("Isi kondisi pasien")}`);

  const { error } = await supabase.from("inpatient_daily_logs").insert({
    inpatient_record_id: recordId, condition_note: conditionNote, tindakan, keterangan,
    doctor_name: doctorName, created_by: user?.id ?? null,
    ...bacaPemantauan(formData),
    ...bacaPetugas(formData,back),
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  redirect(`${back}?success=log`);
}

// Catatan harian rawat inap versi lengkap (desain POS): simpan log harian + obat/jasa
// yang diberikan (masuk ke resep visit → ikut tagihan) + opsi ubah kondisi sekalian.
type RacikBahan = { item_id: string; nama: string; qty: number; satuan: string; harga: number };
type ResepItem = {
  nama_obat: string; qty: number; satuan?: string; harga?: number; jenis?: string;
  aturan_pakai?: string; ingredients?: RacikBahan[]; dosage_form?: string;
  item_id?: string | null; faktor?: number; key?: string;
  official_version_id?: string;
  sale_item_id?: string;
};
export async function addDailyLogPos(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const recordId = String(formData.get("recordId") ?? "");
  const conditionNote = String(formData.get("condition_note") ?? "").trim();
  const tindakan = String(formData.get("tindakan") ?? "").trim() || null;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;
  const doctorName = String(formData.get("doctor_name") ?? "").trim() || null;
  const logDate = String(formData.get("log_date") ?? "").trim();
  const logTime = String(formData.get("log_time") ?? "").trim();
  const requestKey = String(formData.get("request_key") ?? "").trim();
  const newStatus = String(formData.get("new_status") ?? "").trim() as Condition | "";
  const cetak = String(formData.get("cetak") ?? "") === "1";
  const back = `/klinik/rawat-inap/${recordId}`;
  if (!recordId || !conditionNote || !requestKey) redirect(`${back}/catatan?error=${encodeURIComponent("Isi kondisi pasien dan muat ulang formulir")}`);

  const { data: rec } = await supabase
    .from("inpatient_records").select("condition_status, visit_id, medical_record_id").eq("id", recordId).maybeSingle();
  if (!rec) redirect(`${back}/catatan?error=${encodeURIComponent("Data rawat inap tidak ditemukan")}`);

  const stamp = waktuInputWIB(logDate, logTime);
  const log = {
    condition_note: conditionNote, tindakan, keterangan, doctor_name: doctorName,
    ...bacaPetugas(formData,`${back}/catatan`),
    ...bacaPemantauan(formData),
    log_date: logDate || null,
    created_at: stamp && !Number.isNaN(stamp.getTime()) ? stamp.toISOString() : null,
  };

  // Resep ditautkan ke rekam medis dan disimpan bersama log dalam satu transaksi.
  let mrId = rec!.medical_record_id as string | null;
  if (!mrId) {
    const { data: mr } = await supabase.from("medical_records").select("id").eq("visit_id", rec!.visit_id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    mrId = mr?.id ?? null;
  }
  let resep: ResepItem[] = [];
  try { resep = JSON.parse(String(formData.get("resep") ?? "[]")); } catch { resep = []; }
  const racikan = resep.filter((r) => r.jenis === "racikan");
  if (racikan.some((r) => !r.official_version_id &&
    (r.ingredients ?? []).filter((b) => b.item_id && Number(b.qty) > 0).length === 0)) {
    redirect(`${back}/catatan?error=${encodeURIComponent("Setiap racikan harus memiliki minimal satu bahan")}`);
  }
  if (resep.length && !mrId) {
    redirect(`${back}/catatan?error=${encodeURIComponent("Rekam medis belum tersedia untuk menautkan resep ke tagihan")}`);
  }
  let rows: { nama_obat: string; item_id: string | null; qty: number; satuan: string; faktor: number; harga: number; aturan_pakai: string | null; jenis: string }[] = [];
  if (mrId && resep.length) {
    // Faktor satuan diambil ulang dari master, bukan dari form (lihat simpanRekamMedis).
    const unitOpts = await loadUnitOptions(supabase, resep.map((r) => r.item_id).filter((x): x is string => !!x));
    rows = resep.filter((r) => r.nama_obat?.trim() && r.jenis !== "racikan").map((r) => ({
      nama_obat: r.nama_obat.trim(), item_id: r.item_id ?? null,
      qty: Number(r.qty) > 0 ? Number(r.qty) : 1,
      satuan: r.satuan?.trim() || "pcs",
      faktor: !r.item_id ? 1 : (unitOpts.get(r.item_id) ? pickUnit(unitOpts.get(r.item_id)!, r.satuan).factor : 1),
      harga: Number(r.harga) > 0 ? Number(r.harga) : 0,
      aturan_pakai: r.aturan_pakai?.trim() || null,
      // racikan ditagih sebagai baris "obat" — sama seperti jalur simpanRekamMedis.
      jenis: r.jenis === "jasa" ? "jasa" : "obat",
    }));
  }

  const compounds = racikan.map((r) => r.official_version_id ? {
    official_version_id: r.official_version_id,
    ...(r.sale_item_id ? { sale_item_id: r.sale_item_id } : {}),
    request_key: r.key ?? "",
    dosage_instruction: r.aturan_pakai ?? null,
  } : {
    ...(r.sale_item_id ? { sale_item_id: r.sale_item_id } : {}),
    recipe: toClinicCompoundRecipeInput({
      recipeName: r.nama_obat,
      dosageInstruction: r.aturan_pakai,
      dosageForm: r.dosage_form,
      ingredients: (r.ingredients ?? []).filter((b) => b.item_id && Number(b.qty) > 0),
    }),
    request_key: r.key ?? "",
  });
  if (newStatus && !["stabil", "kritis", "sembuh", "rip"].includes(newStatus)) {
    redirect(`${back}/catatan?error=${encodeURIComponent("Status kondisi tidak valid")}`);
  }
  if (newStatus && newStatus !== rec!.condition_status) {
    const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
    if (!canTransition((me?.role ?? "STAFF") as Role, newStatus)) {
      redirect(`${back}/catatan?error=${encodeURIComponent("Transisi kondisi hanya boleh dilakukan dokter")}`);
    }
  }
  const { error: saveError } = await supabase.rpc("clinic_save_inpatient_log_with_status", {
    p_inpatient_id: recordId,
    p_medical_record_id: mrId,
    p_log: log,
    p_rows: rows,
    p_compounds: compounds,
    p_request_key: requestKey,
    p_new_status: newStatus && newStatus !== rec!.condition_status ? newStatus : null,
  });
  if (saveError) redirect(`${back}/catatan?error=${encodeURIComponent(parseClinicRecordError(saveError))}`);
  revalidatePath(back);
  revalidatePath(`${back}/catatan`);
  revalidatePath(`/klinik/rekam-medis/${rec!.visit_id}/resep`);

  return { saved: true, href: cetak && mrId ? `/klinik/rekam-medis/${rec!.visit_id}/resep` : `${back}?success=log` };
}

// Ubah kondisi (stabil/kritis/sembuh/rip) — rip hanya dokter, wajib tercatat di status log.
export async function changeCondition(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const recordId = String(formData.get("recordId") ?? "");
  const newStatus = String(formData.get("new_status") ?? "") as Condition;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const back = `/klinik/rawat-inap/${recordId}`;
  if (!recordId || !["stabil", "kritis", "sembuh", "rip"].includes(newStatus)) {
    redirect(`${back}?error=${encodeURIComponent("Status tidak valid")}`);
  }

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!canTransition((me?.role ?? "STAFF") as Role, newStatus)) {
    redirect(`${back}?error=${encodeURIComponent("Transisi ke RIP hanya boleh dilakukan oleh dokter")}`);
  }

  const { data: rec } = await supabase
    .from("inpatient_records").select("condition_status").eq("id", recordId).single();
  if (!rec) redirect(`${back}?error=${encodeURIComponent("Data rawat inap tidak ditemukan")}`);
  if (rec!.condition_status === newStatus) redirect(back);

  const { error } = await supabase.rpc("clinic_change_inpatient_condition", {
    p_inpatient_id: recordId, p_new_status: newStatus, p_notes: notes,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(parseClinicRecordError(error))}`);

  // rip → layar review WA dulu (spec default: review sebelum kirim, bukan auto-send).
  redirect(newStatus === "rip" ? `${back}?wa=review` : `${back}?success=status`);
}

// Kirim WA duka (template khusus) setelah dokter review — trigger terpisah dari WA engine rutin.
export async function sendRipWa(formData: FormData) {
  const supabase = await createClient();
  const recordId = String(formData.get("recordId") ?? "");
  const back = `/klinik/rawat-inap/${recordId}`;

  const { data: rec } = await supabase
    .from("inpatient_records")
    .select("condition_status, visits(pets(name), customers(name, phone), branches(name))")
    .eq("id", recordId).maybeSingle();
  if (!rec || rec.condition_status !== "rip") redirect(`${back}?error=${encodeURIComponent("WA duka hanya untuk status RIP")}`);

  type Rel<T> = T | T[] | null;
  const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);
  const visit = one(rec!.visits as Rel<{ pets: Rel<{ name: string }>; customers: Rel<{ name: string; phone: string }>; branches: Rel<{ name: string }> }>);
  const pet = one(visit?.pets ?? null);
  const cust = one(visit?.customers ?? null);
  const branch = one(visit?.branches ?? null);
  if (!cust?.phone) redirect(`${back}?error=${encodeURIComponent("Nomor HP pemilik tidak ada")}`);

  const result = await sendWA(cust!.phone, ripWaMessage(pet?.name ?? "anabul Anda", cust!.name, branch?.name ?? "klinik kami"));
  redirect(result.ok ? `${back}?success=wa` : `${back}?error=${encodeURIComponent("WA gagal terkirim: " + (result.reason ?? ""))}`);
}

// Koreksi catatan harian. Append-only dilonggarkan (spec 2026-07-20) TAPI isi lama
// selalu disnapshot ke inpatient_daily_log_edits — rekam medis yang bisa diubah
// tanpa jejak tidak bisa dipakai kalau ada sengketa dgn pemilik hewan.
export async function updateDailyLog(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const logId = String(formData.get("logId") ?? "");
  const recordId = String(formData.get("recordId") ?? "");
  const conditionNote = String(formData.get("condition_note") ?? "").trim();
  const tindakan = String(formData.get("tindakan") ?? "").trim() || null;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;
  const doctorName = String(formData.get("doctor_name") ?? "").trim() || null;
  const logDate = String(formData.get("log_date") ?? "").trim();
  const logTime = String(formData.get("log_time") ?? "").trim();
  const alasan = String(formData.get("alasan") ?? "").trim() || null;

  const back = `/klinik/rawat-inap/${recordId}`;
  const here = `${back}/catatan/${logId}`;
  if (!logId || !recordId) redirect(`${back}?error=${encodeURIComponent("Catatan tidak valid")}`);
  if (!conditionNote) redirect(`${here}?error=${encodeURIComponent("Kondisi pasien wajib diisi")}`);

  const { data: before } = await supabase
    .from("inpatient_daily_logs")
    .select("id, inpatient_record_id, log_kind, log_date, condition_note, tindakan, keterangan, doctor_name, created_at, makan, minum, bab, pipis, berat, suhu, foto_url, komunikasi_owner, komunikasi_via")
    .eq("id", logId).maybeSingle();
  if (!before) redirect(`${back}?error=${encodeURIComponent("Catatan tidak ditemukan")}`);
  if(before.inpatient_record_id!==recordId)redirect(`${back}?error=${encodeURIComponent('Catatan tidak sesuai pasien')}`);

  // Pasien sudah pulang/RIP → catatan dikunci. Koreksi setelah kasus ditutup harus
  // lewat jalur lain, bukan diam-diam dari layar ini.
  const { data: rec } = await supabase
    .from("inpatient_records").select("discharged_at").eq("id", recordId).maybeSingle();
  if (rec?.discharged_at) redirect(`${back}?error=${encodeURIComponent("Rawat inap sudah ditutup — catatan tidak bisa diubah lagi")}`);

  const stamp = waktuInputWIB(logDate, logTime);
  const { error: upErr } = await supabase.rpc('clinic_update_inpatient_log',{
    p_inpatient_id:recordId,p_log_id:logId,p_reason:alasan,p_patch:{
    condition_note: conditionNote, tindakan, keterangan, doctor_name: doctorName,
    ...bacaPetugas(formData,here,before.log_kind==null),
    updated_at: new Date().toISOString(), updated_by: user?.id ?? null,
    // Angka pemantauan ikut bisa dikoreksi; nilai lamanya tersimpan di snapshot
    // `before` — berat/suhu yang salah ketik tidak boleh berubah tanpa jejak.
    ...bacaPemantauan(formData),
    ...(logDate ? { log_date: logDate } : {}),
    ...(stamp && !Number.isNaN(stamp.getTime()) ? { created_at: stamp.toISOString() } : {}),
    },
  });
  if (upErr) redirect(`${here}?error=${encodeURIComponent(parseClinicRecordError(upErr))}`);

  redirect(`${back}?success=logedit`);
}

// ── Obat khusus (permintaan drh. Ilham, 24 Agustus) ───────────────────────────

/** Protokol obat: obat apa, berapa kali sehari, berapa hari. */
export async function tambahObatInap(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const recordId = String(formData.get("recordId") ?? "");
  const back = `/klinik/rawat-inap/${recordId}`;
  const gagal = (msg: string): never => redirect(`${back}?error=${encodeURIComponent(msg)}`);

  const nama = String(formData.get("nama_obat") ?? "").trim().slice(0, 120);
  const itemId = String(formData.get("item_id") ?? "").trim() || null;
  const frekuensi = Number(formData.get("frekuensi_per_hari")) || 0;
  const durasi = Number(formData.get("durasi_hari")) || 0;
  const mulai = String(formData.get("mulai_tanggal") ?? "").trim() || hariIniWIB();

  if (!recordId) gagal("Data rawat inap tidak valid");
  if (!nama) gagal("Nama obat wajib diisi");
  if (frekuensi < 1 || frekuensi > 12) gagal("Berapa kali sehari harus antara 1 dan 12");
  if (durasi < 1 || durasi > 60) gagal("Berapa hari harus antara 1 dan 60");

  const { error } = await supabase.from("inpatient_medications").insert({
    inpatient_record_id: recordId,
    item_id: itemId,
    nama_obat: nama,
    dosis: String(formData.get("dosis") ?? "").trim().slice(0, 60) || null,
    rute: String(formData.get("rute") ?? "").trim().slice(0, 20) || null,
    frekuensi_per_hari: frekuensi,
    durasi_hari: durasi,
    mulai_tanggal: mulai,
    catatan: String(formData.get("catatan") ?? "").trim() || null,
    created_by: user?.id ?? null,
  });
  if (error) gagal(error.message);

  revalidatePath(back);
  redirect(`${back}?success=obat`);
}

/**
 * Catat satu kali pemberian obat.
 *
 * Nama pemberi ikut disimpan sebagai teks, bukan cuma id akunnya: jejak siapa yang
 * menyuntik harus tetap terbaca walau akunnya nanti dinonaktifkan.
 */
export async function catatPemberianObat(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const medicationId = String(formData.get("medicationId") ?? "");
  const recordId = String(formData.get("recordId") ?? "");
  const back = `/klinik/rawat-inap/${recordId}`;
  if (!medicationId) redirect(`${back}?error=${encodeURIComponent("Obat tidak valid")}`);

  const { data: me } = await supabase
    .from("profiles").select("full_name").eq("id", user?.id ?? "").maybeSingle();

  const { error } = await supabase.from("inpatient_med_doses").insert({
    medication_id: medicationId,
    diberikan_oleh: user?.id ?? null,
    nama_pemberi: me?.full_name ?? null,
    catatan: String(formData.get("catatan") ?? "").trim() || null,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(back);
  redirect(`${back}?success=dosis`);
}

/** Hentikan protokol lebih awal — sisa jadwalnya berhenti menagih. */
export async function hentikanObatInap(formData: FormData) {
  const supabase = await createClient();
  const medicationId = String(formData.get("medicationId") ?? "");
  const recordId = String(formData.get("recordId") ?? "");
  const back = `/klinik/rawat-inap/${recordId}`;
  if (!medicationId) redirect(`${back}?error=${encodeURIComponent("Obat tidak valid")}`);

  await supabase.from("inpatient_medications")
    .update({ dihentikan_at: new Date().toISOString() }).eq("id", medicationId);

  revalidatePath(back);
  redirect(`${back}?success=stopobat`);
}

/** Salah catat pemberian: ditandai batal, bukan dihapus — jejaknya tetap ada. */
export async function batalkanPemberianObat(formData: FormData) {
  const supabase = await createClient();
  const doseId = String(formData.get("doseId") ?? "");
  const recordId = String(formData.get("recordId") ?? "");
  const back = `/klinik/rawat-inap/${recordId}`;
  if (!doseId) redirect(`${back}?error=${encodeURIComponent("Catatan pemberian tidak valid")}`);

  await supabase.from("inpatient_med_doses")
    .update({ dibatalkan_at: new Date().toISOString() }).eq("id", doseId);

  revalidatePath(back);
  redirect(`${back}?success=dosisbatal`);
}
