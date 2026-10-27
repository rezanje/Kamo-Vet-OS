import type { ClinicalCorrection } from "@/lib/clinical-correction";
import { servicePerformerNames, type ServicePerformersSnapshot } from "@/lib/service-performers";
import { loadBranchGroomingPolicy, loadServiceStaff } from "@/lib/service-performers-server";
import { loadClinicItemCategories, splitClinicItems } from "@/lib/clinic-item-categories";
import { TransactionForm } from "@/components/LocalTransactionDraft";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { unitOptions, type ItemUnit } from "@/lib/satuan";
import { hargaCabang, applyHargaCabang } from "@/lib/harga-cabang";
import { daftarDokter } from "@/lib/dokter";
import { performersForService } from '@/lib/clinical-staff';
import { RekamForm } from "./RekamForm";
import { RacikanInline } from "./RacikanInline";
import { ConsentSection, type ConsentRow } from "@/app/(app)/klinik/consent/ConsentSection";
import { clinicAdmissionReadiness } from "@/lib/clinic-admission-readiness";
import { templatesForBranch } from "@/lib/consent";
import { admitInpatient, continueToInpatient } from "@/app/(app)/klinik/rawat-inap/actions";
import { readVisitContinuation, STAY_TYPE_LABEL, STAY_TYPES } from "@/lib/inpatient-stay";
import { SubmitButton } from "@/components/SubmitButton";
import { bacaSaudaraKunjungan } from "@/lib/rombongan-server";
import { ReferralPanel } from "./ReferralPanel";
import { bolehRacikKhusus, loadKatalogRacikan } from "@/lib/katalog-racikan-server";
import { loadClinicCompoundSkus, loadClinicSkuDetails } from "@/lib/clinic-compound-skus";
import { readCompleteList } from "@/lib/checked-list";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

// §3.4 visit state machine — 6 tahap sesuai desain dokter poli (referensi).
const STEPS: [string, string][] = [
  ["Pendaftaran", "ti-file-plus"],
  ["Antrian", "ti-users"],
  ["Rekam Medis", "ti-stethoscope"],
  ["Rawat Inap", "ti-bed"],
  ["Racik Obat", "ti-flask"],
  ["Pembayaran", "ti-credit-card"],
];

const fmtDaftar = (iso: string) => new Date(iso).toLocaleString("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

export default async function RekamMedisPage({
  params,
  searchParams,
}: {
  params: Promise<{ visitId: string }>;
  searchParams: Promise<{ error?: string; racikan?: string; success?: string; edit?: string }>;
}) {
  const { visitId } = await params;
  const { error, racikan, success, edit } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const draftUserId = user?.id ?? "";

  const { data: visit } = await supabase
    .from("visits")
    .select("id, pet_id, branch_id, poli, status, dokter, doctor_id, keluhan, created_at, source, checked_in_at, service_started_at, service_finished_at, checked_out_at, service_provider_id, pets(name, species, breed, weight, photo_url, created_at), customers(name, phone, address, tier)")
    .eq("id", visitId)
    .maybeSingle();

  if (!visit) notFound();

  const pet = one(visit.pets);
  const cust = one(visit.customers);
  const menungguBayar = visit.status === "Pembayaran";
  const selesai = visit.status === "Selesai";
  const recorded = menungguBayar || selesai; // rekam medis sudah disimpan
  const serviceStaff = recorded ? [] : await loadServiceStaff(supabase, visit.branch_id ?? null);
  const dokterOpsi = recorded ? [] : await daftarDokter(supabase, { branchId: visit.branch_id });
  const providerOpsi = recorded ? [] : performersForService(dokterOpsi, visit.poli);

  // Rekam medis tersimpan (read-only) setelah pemeriksaan selesai.
  let record: (Omit<ClinicalCorrection, "recordId" | "revision" | "prescriptions"> & { id: string; clinical_revision?: number }) | null = null;
  let mrId: string | null = null;
  let mrLoadFailed = false;
  let correctionDataFailed = false;
  let resep: { nama_obat: string; qty: number; satuan?: string | null; aturan_pakai: string | null; jenis?: string; service_performers?: ServicePerformersSnapshot | null }[] = [];
  let racikanList: { id: string; recipe_name: string; dosage_form: string; total_volume: string; status: string }[] = [];
  if (recorded) {
    const { data: mr, error: mrError } = await supabase
      .from("medical_records")
      .select("*")
      .eq("visit_id", visitId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    mrLoadFailed = !!mrError;
    record = mr;
    mrId = mr?.id ?? null;
    if (mr) {
      const { data: pi, error: piError } = await supabase
        .from("prescription_items")
        .select("nama_obat, qty, satuan, aturan_pakai, jenis, service_performers")
        .eq("medical_record_id", mr.id)
        .order("created_at");
      resep = pi ?? [];
      // Addendum §2: racikan bisa lebih dari satu per rekam medis (racikan harian rawat inap).
      const { data: cr, error: crError } = await supabase
        .from("compounding_recipes")
        .select("id, recipe_name, dosage_form, total_volume, status")
        .eq("medical_record_id", mr.id)
        .order("created_at", { ascending: false });
      racikanList = cr ?? [];
      correctionDataFailed = !!(piError || crError);
    }
  }

  const correctionCheck = menungguBayar && !visit.checked_out_at && mrId && !mrLoadFailed && !correctionDataFailed
    ? await supabase.rpc("clinic_can_correct_record", { p_record_id: mrId }) : { data: false, error: null };
  const canCorrect = correctionCheck.data === true && !correctionCheck.error;
  const invoiceCheck = menungguBayar && mrId
    ? await supabase.from("invoices").select("id").eq("visit_id", visitId).limit(1).maybeSingle()
    : { data: null, error: null };
  const canAddRacikan = !!(menungguBayar && !visit.checked_out_at && mrId && !mrLoadFailed
    && !correctionDataFailed && !invoiceCheck.error && !invoiceCheck.data);
  const editing = !!edit && edit === mrId && canCorrect;
  const correction: ClinicalCorrection | undefined = editing && record && mrId ? {
    recordId: mrId, revision: record.clinical_revision ?? 0,
    anamnesis: record.anamnesis, diagnosis: record.diagnosis, therapy: record.therapy,
    suhu: record.suhu, berat: record.berat, gejala_klinis: record.gejala_klinis, hasil_penunjang: record.hasil_penunjang,
    penunjang_urls: record.penunjang_urls, follow_up: record.follow_up, catatan_resep: record.catatan_resep,
    prescriptions: resep, compounds: racikanList,
  } : undefined;
  const { data: savedProvider } = editing && visit.service_provider_id
    ? await supabase.from("employees").select("id,nama,jabatan").eq("id", visit.service_provider_id).maybeSingle()
    : { data: null };

  // Rawat inap aktif utk visit ini (Addendum §3 — admit dari rekam medis, design klinik/07).
  const [{ data: inpatient, error: inpatientError }, { data: referralRows }] = await Promise.all([
    supabase.from("inpatient_records")
      .select("id, condition_status, discharged_at")
      .eq("visit_id", visitId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("visit_referrals")
      .select("id, direction, facility, reason, notes, referred_at")
      .eq("visit_id", visitId).order("referred_at", { ascending: false }),
  ]);

  const STEP_BY_STATUS: Record<string, number> = { Menunggu: 1, Diperiksa: 2, Pembayaran: 5, Selesai: 6 };
  const activeStep = STEP_BY_STATUS[visit.status] ?? 2;

  // Rawat Inap & Racik Obat itu opsional — banyak kunjungan rawat jalan gak pernah
  // lewat situ. Setelah rekam medis tersimpan (recorded), status "sudah lewat tahap
  // ini" dari activeStep gak lagi cukup: kalau datanya emang gak ada, jangan
  // ditampilkan sbg "Selesai" (menyesatkan) — sembunyikan aja dari stepper.
  // Selama masih diperiksa (belum recorded), tetap tampil apa adanya (masih mungkin dipakai).
  const hideRawatInap = recorded && !inpatient;
  const hideRacikObat = recorded && racikanList.length === 0;
  const stepsShown = STEPS.filter(([s]) => !(s === "Rawat Inap" && hideRawatInap) && !(s === "Racik Obat" && hideRacikObat));

  // Daftar obat (form pemeriksaan) + bahan baku (racikan inline, dipakai juga di recorded view)
  // + jasa. Jasa wajib dari master SKU — dokter tidak boleh mengetik jasa bebas.
  type ItemLiteFull = {
    id: string; code?: string | null; upc?: string | null; name: string; unit: string; sell_price: number; stok: number;
    is_compound_material: boolean; item_type?: string; tindakan_kategori?: string | null;
    units?: ItemUnit[];
  };
  let obatItems: ItemLiteFull[] = [];
  let bahanItems: ItemLiteFull[] = [];
  let jasaItems: ItemLiteFull[] = [];
  let tindakanItems: ItemLiteFull[] = [];
  let racikanItems: ItemLiteFull[] = [];
  const katalogRacikan = !recorded ? await loadKatalogRacikan() : [];
  const bolehManual = await bolehRacikKhusus();
  if (!recorded) {
    const masterRows = await readCompleteList<{
      id: string; code: string | null; upc: string | null; name: string; unit: string; sell_price: number; is_compound_material: boolean;
      item_type: string; tindakan_kategori: string | null; category_id: string | null;
    }>((from, to) => supabase
      .from("items").select("id, code, upc, name, unit, sell_price, is_compound_material, item_type, tindakan_kategori, category_id", { count: "exact" })
      .eq("is_active", true).order("name").order("id").range(from, to), "Barang klinik");
    const categories = await loadClinicItemCategories(supabase);
    const compoundRows = await loadClinicCompoundSkus(supabase, categories);
    const compoundIds = new Set(compoundRows.map(item => item.id));
    const itemRows = [...new Map([...masterRows, ...compoundRows].map(item => [item.id, item])).values()];
    const ids = (itemRows ?? []).map((i) => i.id);

    const { stock: stokByItem, units: unitMap, prices: hargaMap } = await loadClinicSkuDetails(supabase, ids, visit.branch_id);
    const all = (itemRows ?? []).map((i) => ({
      id: i.id as string, code: "code" in i ? i.code as string | null : null, upc: "upc" in i ? i.upc as string | null : null, name: i.name as string, unit: (i.unit as string) ?? "pcs",
      sell_price: hargaCabang(hargaMap, i.id as string, i.unit as string, Number(i.sell_price)),
      stok: stokByItem.get(i.id as string) ?? 0,
      units: applyHargaCabang(
        unitOptions(
          { unit: (i.unit as string) ?? "pcs", sell_price: Number(i.sell_price) },
          unitMap.get(i.id as string) ?? [],
        ),
        i.id as string,
        hargaMap,
      ),
      is_compound_material: Boolean(i.is_compound_material),
      item_type: (i.item_type as string) ?? "Persediaan",
      category_id: i.category_id,
      tindakan_kategori: (i.tindakan_kategori as string | null) ?? null,
    }));
    const groups = splitClinicItems(all, categories, compoundIds);
    jasaItems = groups.jasa;
    tindakanItems = groups.tindakan;
    obatItems = groups.obat;
    racikanItems = groups.racikan;
    bahanItems = groups.bahan;
  }

  // Form persetujuan (spec 2026-07-20) — template yang berlaku utk cabang kunjungan ini.
  const [{ data: consentRows, error: consentsError }, { data: tplRows, error: templatesError }] = await Promise.all([
    supabase.from("consents")
      .select("id, tindakan, isi_snapshot, kategori, template_id, status, signer_name, signature_data, signed_at")
      .eq("visit_id", visitId).order("created_at"),
    supabase.from("consent_templates").select("id, nama, kategori, branch_id, is_active"),
  ]);
  const consents = (consentRows ?? []) as ConsentRow[];
  const templates = templatesForBranch(
    (tplRows ?? []) as { id: string; nama: string; kategori?: string; branch_id: string | null; is_active: boolean }[],
    (visit.branch_id as string) ?? null,
  );
  const { data: inpatientConsentRule, error: ruleError } = await supabase.from("consent_rules")
    .select("wajib,template_id").eq("kategori", "Rawat Inap").maybeSingle();
  // K06: kunjungan yang sudah punya tagihan aktif juga dianggap tutup — rawat inap
  // tidak boleh menumpuk biaya ke tagihan itu.
  const [activeInvoiceCheck, continuation] = await Promise.all([
    !inpatient && menungguBayar
      ? supabase.from("invoices").select("id, voided_at").eq("visit_id", visitId)
      : Promise.resolve({ data: [] as { id: string; voided_at: string | null }[], error: null }),
    readVisitContinuation(supabase, visitId),
  ]);
  const hasActiveInvoice = Array.isArray(activeInvoiceCheck.data)
    && (activeInvoiceCheck.data as { voided_at: string | null }[]).some((row) => !row.voided_at);
  const admission = clinicAdmissionReadiness({
    readFailed: !!(consentsError || templatesError || ruleError || inpatientError || mrLoadFailed || activeInvoiceCheck.error),
    hasActiveInvoice,
    status: visit.status, checkedOutAt: visit.checked_out_at ?? null, doctorId: visit.doctor_id ?? null,
    medicalRecordId: mrId, rule: inpatientConsentRule, consents: consentRows ?? [],
  });

  // Satu pemilik yang datang membawa beberapa hewan: tiap hewan punya rekam medis
  // dan input obatnya sendiri, dokter tinggal pindah tab tanpa balik ke antrian.
  const saudara = await bacaSaudaraKunjungan(supabase, visitId);

  const petIdCode = pet
    ? `RM-${new Date(visit.created_at as string).toISOString().slice(2, 10).replace(/-/g, "")}-${(visit.id as string).slice(0, 4).toUpperCase()}`
    : "—";
  const tglPeriksa = new Date(visit.created_at as string).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const groomingPolicy = !recorded && visit.branch_id ? await loadBranchGroomingPolicy(supabase, visit.branch_id) : null;
  const groomingDoctorRequired = groomingPolicy?.doctorRequired ?? false;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik/antrian" className="back-btn">
          <i className="ti ti-arrow-left" /> Antrian
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Rekam Medis</span>
      </div>

      {/* Tab per hewan — muncul hanya kalau pemilik ini datang membawa lebih dari
          satu hewan hari ini. Tiap tab kunjungan tersendiri: rekam medis, resep,
          dan racikannya tidak tercampur. */}
      {saudara.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 11, flexWrap: "wrap", alignItems: "center" }}>
          {saudara.map((s, i) => {
            const aktif = s.visitId === visitId;
            const beres = s.status === "Pembayaran" || s.status === "Selesai";
            return (
              <Link key={s.visitId} href={`/klinik/rekam-medis/${s.visitId}`} style={tabHewan(aktif)}>
                <i className={`ti ${beres ? "ti-circle-check" : "ti-paw"}`} style={{ marginRight: 5 }} />
                {s.hewan || `Hewan ${i + 1}`}
              </Link>
            );
          })}
          <span style={{ fontSize: 11, color: "var(--td)" }}>
            {cust?.name ?? "Pemilik ini"} membawa {saudara.length} hewan hari ini — rekam medis & obat diisi per hewan.
          </span>
        </div>
      )}

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success === "correction" && <div className="p2ban" role="status">Koreksi catatan klinis tersimpan.</div>}
      {success === "lanjutan" && (
        <div className="p2ban" role="status" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Kunjungan lanjutan rawat inap dibuka. Tandatangani persetujuan rawat inap, lalu masukkan pasien di bagian Rawat inap di bawah.
        </div>
      )}
      {continuation.sourceVisit && (
        <div className="p2ban" style={{ justifyContent: "space-between" }}>
          <span><i className="ti ti-link" /> Lanjutan rawat inap dari kunjungan rawat jalan{continuation.sourceVisit.created_at ? ` ${fmtDaftar(continuation.sourceVisit.created_at)}` : ""}. Tagihan kunjungan asal tidak diubah; biaya rawat inap ditagih di kunjungan ini.</span>
          <Link href={`/klinik/rekam-medis/${continuation.sourceVisit.id}`} className="btn-def" style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>Rekam medis asal</Link>
        </div>
      )}
      {edit && !editing && <div className="p2ban" role="alert">Koreksi belum dapat dibuka. Periksa akses, status kunjungan, dan muat ulang data pemeriksaan.</div>}
      {racikan === "dibuat" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Racikan dibuat — stok bahan terpotong, worklist apoteker terupdate.
        </div>
      )}
      {racikan === "void" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Racikan di-void, stok bahan dikembalikan. Buat racikan baru bila perlu.
        </div>
      )}
      {success === "consent" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Form persetujuan dibuat — minta pemilik menandatangani.
        </div>
      )}
      {success === "ttd" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Form persetujuan ditandatangani.
        </div>
      )}
      {success === "referral" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Referral tersimpan dan masuk audit kunjungan.
        </div>
      )}

      {/* Stepper status kunjungan (§3.4) — ikon + sub-status (ala referensi) */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>
          {stepsShown.map(([s, ic], shownI) => {
            const i = STEPS.findIndex(([name]) => name === s); // index asli — activeStep dihitung dari 6 tahap, bukan yg tampil
            const done = i < activeStep;
            const active = i === activeStep;
            const on = done || active;
            const sub = done ? "Selesai" : active ? "Proses" : "Belum";
            return (
              <div key={s} style={{ display: "flex", alignItems: "flex-start", flex: shownI < stepsShown.length - 1 ? 1 : "0 0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{
                    width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                    background: on ? "var(--posb)" : "#f3f4f6",
                    color: on ? "#fff" : "var(--td)",
                    border: active ? "2px solid #93c5fd" : "none",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                  }}>
                    {done ? <i className="ti ti-check" /> : <i className={`ti ${ic}`} />}
                  </span>
                  <div style={{ lineHeight: 1.2 }}>
                    <div style={{ fontSize: 11.5, fontWeight: active ? 700 : 500, color: on ? "var(--posb)" : "var(--tm)" }}>{s}</div>
                    <div style={{ fontSize: 9.5, color: active ? "var(--posb)" : "var(--td)" }}>{sub}</div>
                  </div>
                </div>
                {shownI < stepsShown.length - 1 && (
                  <div style={{ flex: 1, height: 2, background: done ? "var(--posb)" : "var(--bd)", margin: "16px 9px 0" }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Identitas pasien — hanya di mode read-only (form input punya kartu pasien sendiri) */}
      {recorded && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 28px" }}>
            <Field label="Pasien" value={`${pet?.name ?? "—"} · ${pet?.species ?? ""}${pet?.breed ? " / " + pet.breed : ""}`} />
            <Field label="Berat" value={pet?.weight ? `${pet.weight} kg` : "—"} />
            <Field label="Pemilik" value={`${cust?.name ?? "—"} · ${cust?.phone ?? ""}`} />
            <Field label="Poli" value={visit.poli} />
            {visit.dokter && <Field label="Dokter" value={visit.dokter} />}
            <Field label="Keluhan" value={visit.keluhan ?? "—"} />
          </div>
        </div>
      )}

      {recorded && (
        <div className="card" style={{ marginBottom: 12, fontSize: 11 }}>
          <div className="card-hd"><i className="ti ti-timeline" style={{ color: "var(--posb)" }} /> Waktu layanan</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 22px", color: "var(--tm)" }}>
            <span>Sumber: <b style={{ color: "var(--tx)" }}>{visit.source === "booking" ? "Booking" : "Walk-in"}</b></span>
            <span>Check-in: <b style={{ color: "var(--tx)" }}>{visit.checked_in_at ? fmtDaftar(visit.checked_in_at) : "Belum tercatat"}</b></span>
            <span>Mulai: <b style={{ color: "var(--tx)" }}>{visit.service_started_at ? fmtDaftar(visit.service_started_at) : "Belum tercatat"}</b></span>
            <span>Selesai: <b style={{ color: "var(--tx)" }}>{visit.service_finished_at ? fmtDaftar(visit.service_finished_at) : "Belum tercatat"}</b></span>
            <span>Check-out: <b style={{ color: "var(--tx)" }}>{visit.checked_out_at ? fmtDaftar(visit.checked_out_at) : "Belum tercatat"}</b></span>
          </div>
        </div>
      )}

      {recorded && !editing ? (
        <>
          {menungguBayar ? (
            <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e", justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <i className="ti ti-clock-dollar" /> Pemeriksaan selesai — menunggu pembayaran.
              </span>
              <Link href={`/klinik/pembayaran/${visit.id}`} className="btn-acc"
                style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>
                Lanjut ke Pembayaran <i className="ti ti-arrow-right" />
              </Link>
            </div>
          ) : (
            <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
              <i className="ti ti-circle-check" /> Kunjungan selesai. Rekam medis terkunci (read-only).
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <Link href={`/klinik/rekam-medis/${visit.id}/dokumen`} className="btn-acc" style={{ textDecoration: "none", background: "var(--posb)" }}>
              <i className="ti ti-file-text" /> Cetak Rekam Medis
            </Link>
          </div>
          <div className="grid2">
            <div className="card">
              <div className="card-hd" style={{ justifyContent: "space-between" }}><span><i className="ti ti-stethoscope" style={{ color: "var(--acc)" }} /> Hasil pemeriksaan</span>
                {canCorrect && <Link href={`/klinik/rekam-medis/${visit.id}?edit=${mrId}`} className="btn-def"><i className="ti ti-edit" /> Edit</Link>}
              </div>
              <ReadField label="Anamnesis / catatan klinis" value={record?.anamnesis} />
              <ReadField label="Diagnosa" value={record?.diagnosis} />
              <ReadField label="Terapi / tindakan" value={record?.therapy} />
            </div>
            <div className="card">
              <div className="card-hd" style={{ justifyContent: "space-between" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <i className="ti ti-prescription" style={{ color: "#16a34a" }} /> Resep obat
                </span>
                <Link href={`/klinik/rekam-medis/${visit.id}/resep`} className="btn-def"
                  style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <i className="ti ti-printer" /> Cetak resep
                </Link>
              </div>
              {resep.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--td)" }}>Tidak ada resep.</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr><th>Obat</th><th style={{ textAlign: "center" }}>Qty</th><th>Aturan pakai</th></tr>
                  </thead>
                  <tbody>
                    {resep.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{r.nama_obat}{r.jenis === "jasa" && <div style={{fontSize:10}}>{servicePerformerNames(r.service_performers).join(" · ")}</div>}</td>
                        <td style={{ textAlign: "center" }}>{r.qty}</td>
                        <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.aturan_pakai ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Racik obat (Addendum §2) — bisa >1 racikan per rekam medis (racikan harian rawat inap). */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-hd">
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <i className="ti ti-flask" style={{ color: "#7c3aed" }} /> Obat racikan
              </span>
            </div>
            {racikanList.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--td)" }}>Belum ada racikan untuk kunjungan ini.</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Racikan</th><th>Bentuk</th><th>Jumlah</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {racikanList.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 500 }}>{c.recipe_name}</td>
                      <td style={{ fontSize: 11, textTransform: "capitalize" }}>{c.dosage_form}</td>
                      <td style={{ fontSize: 11 }}>{c.total_volume}</td>
                      <td><span className={`bge ${c.status === "handed_over" ? "g" : c.status === "ready" ? "b" : c.status === "void" ? "r" : "o"}`}>
                        {c.status === "pending" ? "Menunggu diracik" : c.status === "ready" ? "Siap diserahkan" : c.status === "handed_over" ? "Diserahkan" : "Void"}
                      </span></td>
                      <td>
                        <Link href={`/klinik/racik/${c.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10, textDecoration: "none" }}>
                          Detail
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {mrId && canAddRacikan && (
              <div style={{ marginTop: 10 }}>
                <RacikanInline key={`${visit.id}:${mrId}`} visitId={visit.id} medicalRecordId={mrId} bahanItems={bahanItems} bolehManual={bolehManual} />
              </div>
            )}
          </div>

          <div id="persetujuan-rawat-inap" style={{ marginTop: 12, scrollMarginTop: 20 }}>
            {consentsError || templatesError ? <div className="card" role="alert"><p>Data persetujuan belum dapat dimuat lengkap. Muat ulang sebelum membuat atau menandatangani form baru.</p><Link className="back-btn" href={`/klinik/rekam-medis/${encodeURIComponent(visitId)}`}>Muat ulang persetujuan</Link></div> : <ConsentSection visitId={visit.id as string} consents={consents} templates={templates} />}
          </div>

          <ReferralPanel key={visit.id} visitId={visit.id as string} referrals={(referralRows ?? []) as { id: string; direction: string; facility: string; reason: string; notes: string | null; referred_at: string }[]} />

          {/* Rawat inap (Addendum §3) — popup "Catatan Rawat Inap" design klinik/07 sebagai card inline. */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-hd" style={{ justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <i className="ti ti-bed" style={{ color: "var(--acc)" }} /> Rawat inap
              </span>
              {inpatient && (
                <Link href={`/klinik/rawat-inap/${inpatient.id}`} className="btn-acc"
                  style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <i className="ti ti-eye" /> Lihat Detail Rawat Inap
                </Link>
              )}
            </div>
            {inpatient ? (
              <div style={{ fontSize: 11.5, color: "var(--tm)" }}>
                Pasien {inpatient.discharged_at ? "pernah dirawat inap (sudah keluar)" : "sedang dirawat inap"} — kondisi terakhir:{" "}
                <span className={`bge ${inpatient.condition_status === "kritis" || inpatient.condition_status === "rip" ? "r" : inpatient.condition_status === "sembuh" ? "b" : "g"}`}>
                  {inpatient.condition_status}
                </span>
              </div>
            ) : null}
            {!inpatient && continuation.continuations.length > 0 && (
              <div style={{ fontSize: 11.5, color: "var(--tm)", marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                Lanjutan rawat inap dari kunjungan ini:
                {continuation.continuations.map((c) => (
                  <Link key={c.id} href={`/klinik/rekam-medis/${c.id}`}>{fmtDaftar(c.created_at)}</Link>
                ))}
              </div>
            )}
            {inpatient ? null : admission.continueFromClosed ? (
              <TransactionForm userId={draftUserId} scope={`inpatient-continue:${visitId}`} action={continueToInpatient} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <input type="hidden" name="visitId" value={visit.id} />
                <input type="hidden" name="request_key" defaultValue={randomUUID()} data-draft-state />
                <div role="status" style={{ width: "100%", fontSize: 12, color: "var(--tm)" }}><p>{admission.reason}</p></div>
                <SubmitButton className="btn-acc" icon="ti-bed" pendingText="Memproses…">Lanjutkan ke Rawat Inap</SubmitButton>
              </TransactionForm>
            ) : (
              <TransactionForm userId={draftUserId} scope={`inpatient-admit:${visitId}`} action={admitInpatient} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <input type="hidden" name="visitId" value={visit.id} />
                <input type="hidden" name="request_key" defaultValue={randomUUID()} data-draft-state />
                <div style={{ flex: 1, minWidth: 170 }}>
                  <label className="flab">Tipe rawat inap *</label>
                  <select className="fi" name="stay_type" defaultValue="sakit" required>
                    {STAY_TYPES.map((t) => <option key={t} value={t}>{STAY_TYPE_LABEL[t]}</option>)}
                  </select>
                </div>
                <div style={{ flex: 2, minWidth: 240 }}>
                  <label className="flab">Rencana tindakan dari dokter PIC *</label>
                  <input className="fi" name="treatment_plan" required maxLength={4000} placeholder="mis. Infus, monitoring intensif 3 hari, terapi antibiotik" />
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <label className="flab">Dokter PIC</label>
                  <input className="fi" name="doctor_name" readOnly defaultValue={visit.dokter ?? ""} placeholder="Drh. ..." />
                </div>
                {!admission.canAdmit && <div role="status" style={{width:"100%",fontSize:12,color:"#b45309"}}><p>{admission.reason}</p>{admission.consentAction&&<a className="back-btn" href="#persetujuan-rawat-inap">Periksa persetujuan khusus Rawat Inap</a>}</div>}
                <SubmitButton className="btn-acc" icon="ti-bed" pendingText="Memproses…" disabled={!admission.canAdmit}>Masukkan Rawat Inap</SubmitButton>
              </TransactionForm>
            )}
          </div>
        </>
      ) : (
        <RekamForm
          service={visit.poli}
          key={`${user?.id ?? ""}:${visitId}:${correction ? `${correction.recordId}:${correction.revision}` : "initial"}`}
          correction={correction}
          visitId={visit.id}
          requestKey={randomUUID()}
          draftUserId={user?.id ?? ""}
          petId={visit.pet_id}
          serviceStaff={serviceStaff}
          groomingDoctorRequired={groomingDoctorRequired}
          groomingApplies={groomingPolicy?.applies ?? false}
          dokterOpsi={dokterOpsi}
          currentWeight={pet?.weight ?? null}
          items={obatItems}
          racikanItems={racikanItems}
          bahanItems={bahanItems}
          jasaItems={jasaItems}
          tindakanItems={tindakanItems}
          katalogRacikan={katalogRacikan}
          bolehManual={bolehManual}
          patient={{
            name: pet?.name ?? "—",
            species: pet?.species ?? "—",
            breed: pet?.breed ?? null,
            noRM: petIdCode,
            tglPeriksa,
            dokter: visit.dokter ?? "",
            dokterId: visit.doctor_id ?? null,
            providerId: visit.service_provider_id ?? null,
            owner: cust?.name ?? "—",
            phone: cust?.phone ?? "—",
            address: cust?.address ?? "—",
            tier: cust?.tier ?? "—",
            keluhan: visit.keluhan ?? null,
            photo: pet?.photo_url ?? null,
          }}
          providerOpsi={savedProvider ? [savedProvider] : providerOpsi}
        />
      )}
    </>
  );
}

// Bentuk tab disamakan dengan tab hewan di layar registrasi — dokter melihat
// pola yang sama di dua layar yang berurutan.
function tabHewan(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center",
    padding: "5px 10px", borderRadius: 7, fontSize: 11.5, fontWeight: 600,
    background: active ? "#eff6ff" : "var(--sf1)",
    color: active ? "var(--posb)" : "var(--tm)",
    border: `.5px solid ${active ? "#bfdbfe" : "var(--bd)"}`,
  };
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, color: "var(--td)" }}>{label}</div>
      <div style={{ fontSize: 12 }}>{value}</div>
    </div>
  );
}

function ReadField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "var(--td)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: "var(--tx)", whiteSpace: "pre-wrap" }}>{value || "—"}</div>
    </div>
  );
}
