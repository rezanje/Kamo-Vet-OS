"use server";
import { servicePerformerInput, type ServicePerformersInput } from "@/lib/service-performers";
import { bmhpInput, type BmhpInput } from "@/lib/procedure-bmhp";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { nilaiPantauUntukDatabase } from "@/lib/monitoring-inap";
import { canTransition, ripWaMessage, type Condition, type Role } from "@/lib/inpatient";
import { parseClinicRecordError, toClinicCompoundRecipeInput } from "@/lib/klinik-posting";
import { loadUnitOptions, pickUnit, type ItemUnit } from "@/lib/satuan";
import { catatWaktu, mulai } from "@/lib/u07-waktu";
import { sendWA } from "@/lib/fonnte";
import { hariIniWIB, waktuInputWIB } from "@/lib/tanggal";
import { inpatientStaffInput } from '@/lib/clinical-staff';
import { isMissingRpc, parseStayType, readStayTypesChecked } from "@/lib/inpatient-stay";

function bacaPetugas(formData:FormData,back:string,allowLegacy=false) {
  try{return formData.has('log_kind')?inpatientStaffInput(formData,allowLegacy):{};}
  catch(error){redirect(`${back}?error=${encodeURIComponent(error instanceof Error?error.message:'Pilih petugas yang valid')}`);}
}

// Admit pasien rawat inap dari rekam medis (popup design klinik/07).
export async function admitInpatient(formData: FormData) {
  const supabase = await createClient();
  const visitId = String(formData.get("visitId") ?? "");
  const treatmentPlan = String(formData.get("treatment_plan") ?? "").trim();
  const requestKey = String(formData.get("request_key") ?? "").trim();
  const back = `/klinik/rekam-medis/${visitId}`;
  const stayType = parseStayType(formData.get("stay_type"));
  if (!visitId || !treatmentPlan || !requestKey) redirect(`${back}?error=${encodeURIComponent("Isi rencana tindakan dan muat ulang formulir rawat inap")}`);
  if (!stayType) redirect(`${back}?error=${encodeURIComponent("Pilih tipe rawat inap")}`);
  // K14: tipe dipilih saat masuk. Sebelum migrasi K14 terpasang, "sakit" tetap
  // berjalan lewat jalur lama; pet hotel ditolak jelas, bukan diam-diam jadi "sakit".
  let { data: recordId, error } = await supabase.rpc("clinic_admit_inpatient_typed", {
    p_visit_id: visitId, p_treatment_plan: treatmentPlan, p_request_key: requestKey, p_stay_type: stayType,
  });
  if (isMissingRpc(error)) {
    if (stayType !== "sakit") redirect(`${back}?error=${encodeURIComponent("Tipe pet hotel belum aktif di database. Hubungi admin.")}`);
    ({ data: recordId, error } = await supabase.rpc("clinic_admit_inpatient", {
      p_visit_id: visitId, p_treatment_plan: treatmentPlan, p_request_key: requestKey,
    }));
  }
  if (error || !recordId) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Gagal masuk rawat inap")}`);
  for (const path of ["/klinik/antrian", "/klinik/rekam-medis", "/klinik/rawat-inap", `/klinik/pembayaran/${visitId}`, back]) revalidatePath(path);
  redirect(`/klinik/rawat-inap/${recordId}?success=admit${transactionDraftAck(formData)}`);
}

// K06: kunjungan rawat jalan yang sudah lunas/selesai dilanjutkan ke rawat inap lewat
// kunjungan lanjutan (tertaut ke kunjungan & rekam medis asal). Tagihan lama tidak
// disentuh; biaya rawat inap nanti ditagih di invoice kunjungan lanjutan.
export async function continueToInpatient(formData: FormData) {
  const supabase = await createClient();
  const visitId = String(formData.get("visitId") ?? "");
  const requestKey = String(formData.get("request_key") ?? "").trim();
  const back = `/klinik/rekam-medis/${visitId}`;
  if (!visitId || !requestKey) redirect(`${back}?error=${encodeURIComponent("Muat ulang formulir rawat inap")}`);
  const { data: nextVisitId, error } = await supabase.rpc("clinic_continue_visit_to_inpatient", {
    p_visit_id: visitId, p_request_key: requestKey,
  });
  if (isMissingRpc(error)) redirect(`${back}?error=${encodeURIComponent("Lanjutan rawat inap belum aktif di database. Hubungi admin.")}`);
  if (error || !nextVisitId) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Gagal membuka lanjutan rawat inap")}`);
  redirect(`/klinik/rekam-medis/${nextVisitId}?success=lanjutan${transactionDraftAck(formData)}`);
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
  service_performers?: ServicePerformersInput | null;
  bmhp?: BmhpInput[];
  nama_obat: string; qty: number; satuan?: string; harga?: number; jenis?: string; kategori?: string;
  aturan_pakai?: string; ingredients?: RacikBahan[]; dosage_form?: string;
  item_id?: string | null; faktor?: number; key?: string;
  official_version_id?: string;
  sale_item_id?: string;
};
const INPATIENT_STATUSES: string[] = ["stabil", "kritis", "sembuh", "rip", "pulang_paksa"];
export async function addDailyLogPos(formData: FormData) {
  const supabase = await createClient();
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
  const waktu = catatWaktu("addDailyLogPos", recordId);

  // Keranjang obat/jasa & BMHP diurai dari form lebih dulu (tanpa database) supaya
  // bacaan master bisa ikut dimulai bersamaan. Validasinya tetap di posisi lama.
  let resep: ResepItem[] = [];
  try { resep = JSON.parse(String(formData.get("resep") ?? "[]")); } catch { resep = []; }
  const resepList: ResepItem[] = Array.isArray(resep) ? resep : [];
  // K02: BMHP is only sent once the database exposes the migrated contract.
  let bmhpRows: (BmhpInput[] | null)[] = [];
  let bmhpError: string | null = null;
  // Tindakan jasa maupun persediaan (pekerjaan pesanan) sama-sama boleh membawa BMHP.
  try { bmhpRows = resepList.map(r => r.item_id && r.jenis !== "racikan" ? bmhpInput(r.bmhp) : null); }
  catch (error) { bmhpError = error instanceof Error ? error.message : "BMHP tidak valid"; }
  const needsBmhp = !bmhpError && bmhpRows.some(row => row?.length);

  // U07: dulu hingga 7 bacaan berurutan sebelum RPC simpan. Sekarang semua dimulai
  // bersamaan (gelombang 1); yang butuh data rawat inap/pengguna langsung menyusul
  // (gelombang 2). Tiap hasil tetap ditunggu & diperiksa di posisi lama, jadi urutan
  // validasi dan pesan galat sama; bacaan gagal menghentikan simpan (fail closed).
  const userP = mulai(supabase.auth.getUser());
  const recP = mulai(supabase
    .from("inpatient_records").select("condition_status, visit_id, medical_record_id").eq("id", recordId).maybeSingle());
  const stayP = mulai(readStayTypesChecked(supabase, [recordId]));
  const mrP = mulai(recP.then(({ data }) => data && !data.medical_record_id
    ? supabase.from("medical_records").select("id").eq("visit_id", data.visit_id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    : null));
  const bmhpSupportP = needsBmhp ? mulai(supabase.rpc("clinic_bmhp_supported")) : null;
  // Faktor satuan diambil ulang dari master, bukan dari form (lihat simpanRekamMedis).
  const unitsP = resepList.length
    ? mulai(loadUnitOptions(supabase, resepList.map((r) => r.item_id).filter((x): x is string => !!x)))
    : null;
  const roleP = newStatus && INPATIENT_STATUSES.includes(newStatus)
    ? mulai(Promise.all([userP, recP]).then(([{ data: { user } }, { data }]) => data && newStatus !== data.condition_status
      ? supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle()
      : null))
    : null;

  await userP;
  const { data: rec } = await recP;
  if (!rec) redirect(`${back}/catatan?error=${encodeURIComponent("Data rawat inap tidak ditemukan")}`);
  // K14: catatan harian pet hotel diisi paramedis; dokter/suhu tidak wajib.
  const stay = await stayP;
  if (stay.failed) redirect(`${back}/catatan?error=${encodeURIComponent("Tipe rawat inap belum dapat diverifikasi. Muat ulang lalu simpan lagi.")}`);
  if (stay.types.get(recordId) === "pet_hotel" && !String(formData.get("paramedic_id") ?? "").trim()) {
    redirect(`${back}/catatan?error=${encodeURIComponent("Pilih paramedis yang mengisi catatan pet hotel")}`);
  }

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
    const mr = await mrP;
    // Fail closed: rekam medis yang gagal dibaca tidak boleh dianggap "belum ada".
    if (mr?.error) redirect(`${back}/catatan?error=${encodeURIComponent("Rekam medis belum dapat dibaca. Muat ulang lalu simpan lagi.")}`);
    mrId = mr?.data?.id ?? null;
  }
  const racikan = resep.filter((r) => r.jenis === "racikan");
  if (racikan.some((r) => !r.official_version_id &&
    (r.ingredients ?? []).filter((b) => b.item_id && Number(b.qty) > 0).length === 0)) {
    redirect(`${back}/catatan?error=${encodeURIComponent("Setiap racikan harus memiliki minimal satu bahan")}`);
  }
  if (resep.length && !mrId) {
    redirect(`${back}/catatan?error=${encodeURIComponent("Rekam medis belum tersedia untuk menautkan resep ke tagihan")}`);
  }
  let rows: { nama_obat: string; item_id: string | null; qty: number; satuan: string; faktor: number; harga: number; aturan_pakai: string | null; jenis: string; kategori: string | null; service_performers?: ServicePerformersInput | null; bmhp_components?: BmhpInput[] }[] = [];
  if (bmhpError) return redirect(`${back}/catatan?error=${encodeURIComponent(bmhpError)}`);
  if (needsBmhp) {
    // Fail closed: cek kontrak yang gagal dibaca = belum aktif (pesan lama tetap).
    const support = await bmhpSupportP!;
    if (support.error || support.data !== true) {
      return redirect(`${back}/catatan?error=${encodeURIComponent("Pencatatan BMHP tindakan belum aktif di database. Hapus BMHP atau hubungi admin.")}`);
    }
  }
  if (mrId && resep.length) {
    // Master satuan yang gagal dibaca tampil sebagai pesan jelas (pola simpanRekamMedis),
    // bukan "periksa koneksi"; simpan tidak dijalankan.
    let unitOpts: Map<string, ItemUnit[]>;
    try { unitOpts = await unitsP!; }
    catch (error) { return redirect(`${back}/catatan?error=${encodeURIComponent(error instanceof Error ? error.message : "Satuan barang belum dapat dibaca")}`); }
    rows = resep.map((r, index) => ({ r, bmhp: bmhpRows[index] })).filter(({ r }) => r.nama_obat?.trim() && r.jenis !== "racikan").map(({ r, bmhp }) => ({
      nama_obat: r.nama_obat.trim(), item_id: r.item_id ?? null,
      qty: Number(r.qty) > 0 ? Number(r.qty) : 1,
      satuan: r.satuan?.trim() || "pcs",
      faktor: !r.item_id ? 1 : (unitOpts.get(r.item_id) ? pickUnit(unitOpts.get(r.item_id)!, r.satuan).factor : 1),
      harga: Number(r.harga) > 0 ? Number(r.harga) : 0,
      aturan_pakai: r.aturan_pakai?.trim() || null,
      // racikan ditagih sebagai baris "obat" — sama seperti jalur simpanRekamMedis.
      jenis: r.jenis === "jasa" ? "jasa" : "obat",
      ...(r.service_performers != null ? {service_performers: servicePerformerInput(r.service_performers)} : {}),
      kategori: r.jenis === "jasa" ? (r.kategori?.trim() || null) : null,
      ...(bmhp?.length ? { bmhp_components: bmhp } : {}),
    }));
  }

  const compounds = racikan.map((r) => r.official_version_id ? {
    official_version_id: r.official_version_id,
    ...(r.sale_item_id ? { sale_item_id: r.sale_item_id } : {}),
    request_key: r.key ?? "",
    dosage_instruction: r.aturan_pakai ?? null,
    ...(r.service_performers != null ? {service_performers: servicePerformerInput(r.service_performers)} : {}),
  } : {
    ...(r.sale_item_id ? { sale_item_id: r.sale_item_id } : {}),
    recipe: toClinicCompoundRecipeInput({
      recipeName: r.nama_obat,
      dosageInstruction: r.aturan_pakai,
      dosageForm: r.dosage_form,
      ingredients: (r.ingredients ?? []).filter((b) => b.item_id && Number(b.qty) > 0),
    }),
    request_key: r.key ?? "",
    ...(r.service_performers != null ? {service_performers: servicePerformerInput(r.service_performers)} : {}),
  });
  if (newStatus && !INPATIENT_STATUSES.includes(newStatus)) {
    redirect(`${back}/catatan?error=${encodeURIComponent("Status kondisi tidak valid")}`);
  }
  if (newStatus && newStatus !== rec!.condition_status) {
    const role = await roleP!;
    // Fail closed: peran yang gagal dibaca tidak boleh diperlakukan sebagai STAFF biasa.
    if (!role || role.error) redirect(`${back}/catatan?error=${encodeURIComponent("Peran pengguna belum dapat diverifikasi. Muat ulang lalu simpan lagi.")}`);
    if (!canTransition((role!.data?.role ?? "STAFF") as Role, newStatus)) {
      redirect(`${back}/catatan?error=${encodeURIComponent("Transisi kondisi hanya boleh dilakukan dokter")}`);
    }
  }
  waktu.tandai("baca");
  const { error: saveError } = await supabase.rpc("clinic_save_inpatient_log_with_status", {
    p_inpatient_id: recordId,
    p_medical_record_id: mrId,
    p_log: log,
    p_rows: rows,
    p_compounds: compounds,
    p_request_key: requestKey,
    p_new_status: newStatus && newStatus !== rec!.condition_status ? newStatus : null,
  });
  waktu.tandai("simpan");
  waktu.selesai();
  if (saveError) redirect(`${back}/catatan?error=${encodeURIComponent(parseClinicRecordError(saveError))}`);
  // Kesegaran data di atas kecepatan: revalidasi membersihkan router cache klien, jadi
  // Back/Forward, sensus rawat inap, tagihan, antrean racik dan stok tidak menampilkan
  // data lama (risiko catatan / baris tagihan ganda). Form catatan sendiri tidak masuk
  // daftar, tapi Next 15.5 tetap merender ulang halaman aktif begitu ada revalidasi
  // apa pun (`pathWasRevalidated`); biaya render itu ditekan lewat bacaan paralel di
  // halaman form, bukan dengan melewatkan revalidasi.
  for (const path of [back, "/klinik/rawat-inap", `/klinik/rekam-medis/${rec!.visit_id}/resep`,
    `/klinik/pembayaran/${rec!.visit_id}`, "/klinik/racik", "/klinik/stok", "/pos/stok"]) revalidatePath(path);

  return { saved: true, href: cetak && mrId ? `/klinik/rekam-medis/${rec!.visit_id}/resep` : `${back}?success=log` };
}

// Ubah kondisi — perubahan status wajib tercatat di status log.
export async function changeCondition(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const recordId = String(formData.get("recordId") ?? "");
  const newStatus = String(formData.get("new_status") ?? "") as Condition;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const back = `/klinik/rawat-inap/${recordId}`;
  if (!recordId || !["stabil", "kritis", "sembuh", "rip", "pulang_paksa"].includes(newStatus)) {
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
  redirect(newStatus === "rip" ? `${back}?wa=review${transactionDraftAck(formData)}` : `${back}?success=status${transactionDraftAck(formData)}`);
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

  // Send the time only when it really changed (minute resolution): a doctor visit keeps its
  // server-set time, and only OWNER/ADMIN may move it (H06, enforced by the database).
  const beforeStamp = before.created_at ? new Date(new Date(before.created_at).getTime() + 7 * 3600_000).toISOString() : "";
  const sameTime = beforeStamp.slice(0, 10) === logDate && beforeStamp.slice(11, 16) === logTime;
  const stamp = sameTime ? null : waktuInputWIB(logDate, logTime);
  const { error: upErr } = await supabase.rpc('clinic_update_inpatient_log',{
    p_inpatient_id:recordId,p_log_id:logId,p_reason:alasan,p_patch:{
    condition_note: conditionNote, tindakan, keterangan, doctor_name: doctorName,
    ...bacaPetugas(formData,here,before.log_kind==null),
    updated_at: new Date().toISOString(), updated_by: user?.id ?? null,
    // Angka pemantauan ikut bisa dikoreksi; nilai lamanya tersimpan di snapshot
    // `before` — berat/suhu yang salah ketik tidak boleh berubah tanpa jejak.
    ...bacaPemantauan(formData),
    ...(logDate && logDate !== before.log_date ? { log_date: logDate } : {}),
    ...(stamp && !Number.isNaN(stamp.getTime()) ? { created_at: stamp.toISOString() } : {}),
    },
  });
  if (upErr) redirect(`${here}?error=${encodeURIComponent(parseClinicRecordError(upErr))}`);

  redirect(`${back}?success=logedit${transactionDraftAck(formData)}`);
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
  redirect(`${back}?success=obat${transactionDraftAck(formData)}`);
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
  redirect(`${back}?success=dosis${transactionDraftAck(formData)}`);
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
