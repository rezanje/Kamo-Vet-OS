"use client";

import { NumberInput } from "@/components/NumberInput";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClinicalCorrection } from "@/lib/clinical-correction";
import { ServicePerformersField } from "@/components/ServicePerformersField";
import { ProcedureBmhpComposer } from "@/components/ProcedureBmhpComposer";
import { ClinicLineSellerField } from "@/components/ClinicLineSellerField";
import { vaccinationBmhp, vaccinationOf, type BmhpRow } from "@/lib/procedure-bmhp";
import { bulkFillServicePerformers, emptyServicePerformers, servicePerformerNames, type ServicePerformersInput, type ServiceStaff } from "@/lib/service-performers";
import { useClinicDraft } from "@/components/useClinicDraft";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanRekamMedis, koreksiRekamMedis } from "./actions";
import { type RacikanIngredient } from "@/lib/racikan";
import { PenunjangUpload } from "@/components/PenunjangUpload";
import { PetPhotoUpload } from "@/components/PetPhotoUpload";
import { FollowUpTable, type FollowUpDraft } from "@/components/FollowUpTable";
import { ClinicServicePicker } from "@/components/ClinicServicePicker";
import { pickUnit, type ItemUnit } from "@/lib/satuan";
import { batasBeratWajar } from "@/lib/anabul";
import { type KatalogRacikan } from "@/lib/katalog-racikan";
import { CompoundEditor } from "@/components/CompoundEditor";
import { masterCompoundCartRow, type CompoundDraft } from "@/lib/master-compound-cart";
import { staffForService } from "@/lib/clinical-staff";
import { isMedicalService } from "@/lib/clinic-required-fields";

export type ItemLite = {
  id: string; code?: string | null; upc?: string | null; name: string; unit: string; sell_price: number; stok: number;
  tindakan_kategori?: string | null; item_type?: string;
  units?: ItemUnit[];   // satuan berjenjang (pcs/box, ml/btl) — kosong = hanya satuan dasar
};
type CartRow = {
  key: string; item_id: string | null; nama_obat: string; qty: number; satuan: string; harga: number;
  faktor: number;
  jenis: "obat" | "jasa" | "racikan";
  kategori?: string;
  ingredients?: RacikanIngredient[]; dosage_form?: string; aturan_pakai?: string;
  official_version_id?: string;
  sale_item_id?: string;
  service_performers?: ServicePerformersInput | null;
  salesperson_id?: string | null;
  /** K02: actual consumables on a procedure row (optional). */
  bmhp?: BmhpRow[];
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Field kiri dgn ikon berwarna (gaya referensi).
function ExamField({ icon, color, label, children }: { icon: string; color: string; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, alignItems: "start", padding: "8px 0", borderBottom: ".5px solid var(--bd)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
        <i className={`ti ${icon}`} style={{ color, fontSize: 16, flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--tx)" }}>{label}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

export function RekamForm({ visitId, petId, requestKey, draftUserId, patient, items, racikanItems, bahanItems, jasaItems, tindakanItems, katalogRacikan, bolehManual, currentWeight, dokterOpsi, providerOpsi, service, serviceStaff = [], groomingDoctorRequired = false, groomingApplies = true, correction }: {
  correction?: ClinicalCorrection;
  visitId: string; petId: string; requestKey: string; draftUserId: string;
  service?: string | null;
  serviceStaff?: ServiceStaff[];
  groomingDoctorRequired?: boolean;
  groomingApplies?: boolean;
  patient: { name: string; species: string; breed: string | null; noRM: string; tglPeriksa: string; dokter: string; dokterId: string | null; providerId: string | null; owner: string; phone: string; address: string; tier: string; keluhan: string | null; photo: string | null };
  items: ItemLite[];
  racikanItems: ItemLite[];
  bahanItems: ItemLite[];
  jasaItems: ItemLite[];
  tindakanItems: ItemLite[];
  katalogRacikan: KatalogRacikan[];
  bolehManual: boolean;
  currentWeight: number | null;
  dokterOpsi: { id: string; nama: string; jabatan: string | null }[];
  providerOpsi: { id: string; nama: string; jabatan: string | null }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"Obat" | "Jasa" | "Tindakan" | "Racikan">("Obat");
  const [search, setSearch] = useState("");
  const [obatPage, setObatPage] = useState(1);
  const [cart, setCart] = useState<CartRow[]>([]);
  const [procedureDraft, setProcedureDraft] = useState<{ item: ItemLite; bmhp: BmhpRow[]; editKey: string | null } | null>(null);
  const [procedureError, setProcedureError] = useState("");
  const procedureCommitted = useRef(false);
  const [bulkPerformers, setBulkPerformers] = useState(emptyServicePerformers);
  const [catatan, setCatatan] = useState("");
  const [discountPct, setDiscountPct] = useState(0);

  // Builder racikan
  const [racikNama, setRacikNama] = useState("");
  const [saleItemId, setSaleItemId] = useState("");
  const [officialVersionId, setOfficialVersionId] = useState("");
  const [racikForm, setRacikForm] = useState("sirup");
  const [racikAturan, setRacikAturan] = useState("");
  const [racikBahan, setRacikBahan] = useState<RacikanIngredient[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [followUps, setFollowUps] = useState<FollowUpDraft[]>([]);
  const [penunjangPaths, setPenunjangPaths] = useState<string[]>(correction?.penunjang_urls ?? []);
  const {
    attachForm: draftAttachForm, submissionKey: draftSubmissionKey, recovered: draftRecovered,
    storageError: draftStorageError, saveError: draftSaveError,
    capture: draftCapture, discard: draftDiscard, submit: draftSubmit,
  } = useClinicDraft({
    userId: draftUserId, scope: correction ? `correction:${visitId}:${correction.recordId}:v${correction.revision}` : `exam:${visitId}`, requestKey,
    optionalSnapshotKeys: ["saleItemId", "procedureDraft"],
    snapshot: { saleItemId, cart, procedureDraft, catatan, discountPct, racikNama, officialVersionId, racikForm, racikAturan, racikBahan, followUps, penunjangPaths },
    restore: (value) => {
      setCart(value.cart);
      setProcedureDraft(value.procedureDraft ?? null);
      if (value.procedureDraft) setTab("Tindakan");
      setCatatan(value.catatan);
      setDiscountPct(value.discountPct);
      setRacikNama(value.racikNama);
      setSaleItemId(value.saleItemId ?? "");
      setOfficialVersionId(value.officialVersionId);
      setRacikForm(value.racikForm);
      setRacikAturan(value.racikAturan);
      setRacikBahan(value.racikBahan);
      setFollowUps(value.followUps);
      setPenunjangPaths(value.penunjangPaths);
    },
  });

  const selectedFormula = katalogRacikan.find((formula) => formula.version_id === officialVersionId);

  const compoundDraft: CompoundDraft = { saleItemId, formulaId: officialVersionId, dosageForm: racikForm, instruction: racikAturan, ingredients: racikBahan };
  const changeCompound = (value: CompoundDraft) => {
    setSaleItemId(value.saleItemId); setOfficialVersionId(value.formulaId); setRacikForm(value.dosageForm);
    setRacikAturan(value.instruction); setRacikBahan(value.ingredients);
    setRacikNama(racikanItems.find(item => item.id === value.saleItemId)?.name ?? "");
  };
  const addRacikanToCart = () => {
    const sku = racikanItems.find(item => item.id === saleItemId) ?? null;
    const row = masterCompoundCartRow(sku, selectedFormula ?? null, compoundDraft, crypto.randomUUID(), bolehManual);
    setCart(rows => [...rows, {...row, salesperson_id:null}]);
    setSaleItemId(""); setOfficialVersionId(""); setRacikNama(""); setRacikAturan(""); setRacikBahan([]);
  };

  const obatMatches = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter(it => [it.name, it.code, it.upc].some(value => value?.toLowerCase().includes(term)));
  }, [items, search]);
  const obatPages = Math.max(1, Math.ceil(obatMatches.length / 40));
  const currentObatPage = Math.min(obatPage, obatPages);
  const filtered = obatMatches.slice((currentObatPage - 1) * 40, currentObatPage * 40);

  const addObat = (it: ItemLite, bmhp?: BmhpRow[]) => {
    setCart((c) => {
      const ex = it.item_type === "Jasa" ? undefined : c.find((r) => r.item_id === it.id && r.jenis !== "jasa");
      if (ex) return c.map((r) => (r.item_id === it.id ? { ...r, qty: r.qty + 1 } : r));
      const isService = it.item_type === "Jasa";
      const u = isService ? undefined : (it.units ?? [])[0];
      return [...c, {
        key: isService ? crypto.randomUUID() : it.id, item_id: it.id, nama_obat: it.name, qty: 1,
        satuan: u?.unit ?? it.unit, harga: u?.sell_price ?? it.sell_price, faktor: u?.factor ?? 1, jenis: isService ? "jasa" : "obat",
        kategori: isService ? it.tindakan_kategori ?? undefined : undefined,
        service_performers: isService ? emptyServicePerformers() : null,
        salesperson_id: null,
        ...(isService && bmhp ? { bmhp } : {}),
      }];
    });
  };
  const selectProcedure = (item: ItemLite): void => {
    // K02 BMHP is stored only on service (Jasa) master lines; a stocked procedure SKU is sold as stock,
    // unless it is a vaccine vial with its own vaccination service.
    if (item.item_type !== "Jasa") return pickObat(item);
    if (procedureDraft?.item.id === item.id && !procedureDraft.editKey) return;
    procedureCommitted.current = false;
    setProcedureError("");
    setProcedureDraft({ item, bmhp: vaccinationBmhp(item, [...items, ...tindakanItems]), editKey: null });
    setTab("Tindakan");
  };
  const pickObat = (it: ItemLite): void => {
    const vaccination = vaccinationOf(it, tindakanItems);
    return vaccination ? selectProcedure(vaccination) : addObat(it);
  };
  const editProcedure = (row: CartRow) => {
    const item = tindakanItems.find(candidate => candidate.id === row.item_id) ?? {
      id: row.item_id!, name: row.nama_obat, unit: row.satuan, sell_price: row.harga,
      stok: 0, item_type: "Jasa", tindakan_kategori: row.kategori,
    };
    procedureCommitted.current = false;
    setProcedureError("");
    setProcedureDraft({ item, bmhp: [...(row.bmhp ?? [])], editKey: row.key });
    setTab("Tindakan");
  };
  const commitProcedure = () => {
    if (!procedureDraft || procedureCommitted.current) return;
    procedureCommitted.current = true;
    if (procedureDraft.editKey) {
      setCart(rows => rows.map(row => row.key === procedureDraft.editKey ? { ...row, bmhp: procedureDraft.bmhp } : row));
    } else {
      addObat(procedureDraft.item, procedureDraft.bmhp);
    }
    setProcedureDraft(null);
    setProcedureError("");
  };
  const setQty = (key: string, qty: number) => setCart((c) => c.map((r) => (r.key === key ? { ...r, qty: Math.max(1, qty) } : r)));
  // Ganti satuan obat (mis. ml → btl): harga & faktor ikut satuan yang dipilih.
  const unitsOf = (itemId: string | null) => (itemId ? [...items, ...racikanItems, ...jasaItems, ...tindakanItems].find((i) => i.id === itemId)?.units ?? [] : []);
  const setSatuan = (key: string, itemId: string | null, unit: string) =>
    setCart((c) => c.map((r) => {
      if (r.key !== key) return r;
      const u = pickUnit(unitsOf(itemId), unit);
      return u ? { ...r, satuan: u.unit, harga: u.sell_price, faktor: u.factor } : r;
    }));
  const del = (key: string) => { setCart((c) => c.filter((r) => r.key !== key)); if (procedureDraft?.editKey === key) setProcedureDraft(null); };
  const clear = () => { setCart([]); setProcedureDraft(null); };

  // ponytail: catatan resep hanya relevan untuk SKU racikan
  const hasRacikan = cart.some((r) => r.jenis === "racikan");

  const subtotal = cart.reduce((a, r) => a + r.qty * r.harga, 0);
  const discountVal = Math.round((subtotal * discountPct) / 100);
  const ppn = 0; // ponytail: PPN 0% (display); tarif final ditentukan kasir saat pembayaran
  const total = Math.max(0, subtotal - discountVal + ppn);

  return (
    <form ref={draftAttachForm} action={(data) => draftSubmit(data, correction ? koreksiRekamMedis : simpanRekamMedis)} onInputCapture={draftCapture} onChangeCapture={draftCapture} onSubmitCapture={event => {
      if (procedureDraft) { event.preventDefault(); event.stopPropagation(); setTab("Tindakan"); setProcedureError("Selesaikan komposisi BMHP tindakan: tambahkan ke keranjang atau batalkan sebelum menyimpan."); }
      else draftCapture();
    }}>
      {draftRecovered && <div role="status" className="p2ban">Draf dipulihkan <button type="button" className="btn-def" onClick={draftDiscard}>Buang draf</button></div>}
      {procedureError && <div role="alert" className="p2ban">{procedureError}</div>}
      {(draftStorageError || draftSaveError) && <div role="alert" className="p2ban">{draftSaveError || draftStorageError}</div>}
      {correction && <div className="p2ban">Koreksi catatan klinis. Resep, racikan, tindak lanjut, dan data pasien tetap mengikuti pemeriksaan tersimpan.</div>}
      {correction && <><input type="hidden" name="medical_record_id" value={correction.recordId} /><input type="hidden" name="expected_revision" value={correction.revision} /></>}
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="petId" value={petId} />
      <input type="hidden" name="request_key" value={draftSubmissionKey} />
      <input type="hidden" name="resep" value={JSON.stringify(cart)} />
      <input type="hidden" name="catatan_resep" value={hasRacikan ? catatan : ""} />

      <div className="grid2" style={{ alignItems: "start" }}>
        {/* ================= KIRI: data pasien + pemeriksaan ================= */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em", marginBottom: 12 }}>DATA PASIEN</div>

          <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
            <PetPhotoUpload petId={petId} initialUrl={patient.photo} readOnly={!!correction} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: "var(--sb)" }}>{patient.name}</span>
                <span className="bge b">{patient.species}{patient.breed ? ` / ${patient.breed}` : ""}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 14px", marginTop: 6, fontSize: 10.5 }}>
                <MiniKV k="No. RM" v={patient.noRM} />
                <MiniKV k="Tgl Periksa" v={patient.tglPeriksa} />
                <MiniKV k="Pemilik" v={patient.owner} />
                {/* Dokter dipilih di sini, bukan cuma ditampilkan: dialah yang
                    dicatat sebagai penanggung jawab kunjungan; pelaksana jasa dipilih per baris. */}
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ color: "var(--tm)", minWidth: 62 }}>Dokter PJ{isMedicalService(service) ? " *" : ""}</span>
                  <select className="fi" name="doctor_id" disabled={!!correction} required={isMedicalService(service)} defaultValue={patient.dokterId ?? ""}
                    style={{ height: 24, fontSize: 10.5, padding: "0 6px", flex: 1 }}>
                    <option value="">— belum ditentukan —</option>
                    {correction && patient.dokterId && <option value={patient.dokterId}>{patient.dokter}</option>}
                    {staffForService(dokterOpsi,service).map((d) => <option key={d.id} value={d.id}>{d.nama}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ color: "var(--tm)", minWidth: 62 }}>PIC kasus</span>
                  <select className="fi" name="provider_id" disabled={!!correction} defaultValue={patient.providerId ?? ""}
                    style={{ height: 24, fontSize: 10.5, padding: "0 6px", flex: 1 }}>
                    <option value="">— belum ditentukan —</option>
                    {correction && patient.providerId && !providerOpsi.some(p => p.id === patient.providerId) && <option value={patient.providerId}>PIC tersimpan</option>}
                    {providerOpsi.map((provider) => <option key={provider.id} value={provider.id}>{provider.nama}{provider.jabatan ? ` · ${provider.jabatan}` : ""}</option>)}
                  </select>
                </div>
                <MiniKV k="No. HP" v={patient.phone} />
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ color: "var(--tm)", minWidth: 62 }}>Kategori</span>
                  <span className="bge" style={{ background: "#f3f4f6", color: "#4b5563", fontWeight: 600 }}><i className="ti ti-award" style={{ marginRight: 3 }} />{patient.tier}</span>
                </div>
              </div>
            </div>
          </div>

          <ExamField icon="ti-message-2" color="var(--posb)" label="Keluhan">
            <input className="fi" name="keluhan" readOnly={!!correction} required={isMedicalService(service)} pattern={isMedicalService(service) ? ".*\\S.*" : undefined} title="Keluhan pasien wajib diisi" defaultValue={patient.keluhan ?? ""} placeholder="Keluhan utama pasien" />
          </ExamField>
          <ExamField icon="ti-file-text" color="var(--posb)" label="Anamnesa">
            <textarea className="fi" name="anamnesis" defaultValue={correction?.anamnesis ?? ""} rows={2} placeholder="Riwayat & perjalanan penyakit" style={{ resize: "vertical" }} />
          </ExamField>
          <ExamField icon="ti-weight" color="#0891b2" label="Berat Badan">
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <NumberInput className="fi" name="berat" type="number" step="0.1" min={0} max={batasBeratWajar(patient.species) ?? undefined} readOnly={!!correction} defaultValue={correction ? correction.berat ?? undefined : currentWeight ?? undefined} placeholder="12.5" style={{ borderRadius: "6px 0 0 6px" }} />
              <span style={{ background: "var(--sf1)", border: ".5px solid var(--bd)", borderLeft: "none", borderRadius: "0 6px 6px 0", padding: "6px 10px", fontSize: 11, color: "var(--tm)" }}>kg</span>
            </div>
          </ExamField>
          <ExamField icon="ti-temperature" color="#dc2626" label="Suhu Badan">
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <NumberInput className="fi" name="suhu" defaultValue={correction?.suhu ?? undefined} type="number" min={0} max={60} step={correction ? "0.01" : "0.1"} placeholder="39.5" style={{ borderRadius: "6px 0 0 6px" }} />
              <span style={{ background: "var(--sf1)", border: ".5px solid var(--bd)", borderLeft: "none", borderRadius: "0 6px 6px 0", padding: "6px 10px", fontSize: 11, color: "var(--tm)" }}>°C</span>
            </div>
          </ExamField>
          <ExamField icon="ti-activity" color="#16a34a" label="Gejala Klinis">
            <input className="fi" name="gejala_klinis" defaultValue={correction?.gejala_klinis ?? ""} placeholder="mis. hidung berair, nafas cepat" />
          </ExamField>
          <ExamField icon="ti-flask" color="#7c3aed" label="Hasil Pemeriksaan Penunjang">
            <input className="fi" name="hasil_penunjang" defaultValue={correction?.hasil_penunjang ?? ""} placeholder="mis. Foto thorax normal" />
            {correction ? <p>{penunjangPaths.length} lampiran pemeriksaan tersimpan.</p> : <PenunjangUpload name="penunjang_urls" value={penunjangPaths} onChange={setPenunjangPaths} />}
          </ExamField>
          <ExamField icon="ti-stethoscope" color="var(--posb)" label="Diagnosa">
            <textarea className="fi" name="diagnosis" defaultValue={correction?.diagnosis ?? ""} rows={2} placeholder="mis. ISPA (Infeksi Saluran Pernapasan Atas)" style={{ resize: "vertical" }} />
          </ExamField>
          <ExamField icon="ti-clipboard-text" color="var(--posb)" label="Terapi / tindakan">
            <textarea className="fi" name="therapy" defaultValue={correction?.therapy ?? ""} aria-label="Terapi / tindakan" rows={3} maxLength={4000} placeholder="Catatan terapi / tindakan (opsional)" style={{ resize: "vertical" }} />
          </ExamField>
        </div>

        {/* ================= KANAN: POS obat & jasa ================= */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em", marginBottom: 12 }}>
            <i className="ti ti-shopping-cart" style={{ color: "var(--posb)" }} /> INPUT OBAT &amp; JASA (POS)
          </div>

          {correction ? <>
            <p>Resep obat &amp; jasa tersimpan</p>
            <table className="tbl"><thead><tr><th>Obat / jasa</th><th>Qty</th><th>Aturan pakai</th></tr></thead><tbody>
              {correction.prescriptions.map((row, i) => <tr key={i}><td>{row.nama_obat}{row.service_performers && <div>{servicePerformerNames(row.service_performers).join(" · ")}</div>}</td><td>{row.qty} {row.satuan}</td><td>{row.aturan_pakai ?? "—"}</td></tr>)}
            </tbody></table>
            {correction.prescriptions.length === 0 && <p>Tidak ada resep.</p>}
            {correction.catatan_resep && <p>{correction.catatan_resep}</p>}
            <p>Racikan tersimpan</p>
            {(correction.compounds ?? []).map(row => <div key={row.id}>{row.recipe_name}</div>)}
            {!correction.compounds?.length && <p>Tidak ada racikan.</p>}
          </> : <>
          {/* Tab jenis */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {([["Obat", "ti-pill"], ["Jasa", "ti-stethoscope"], ["Tindakan", "ti-package"], ["Racikan", "ti-flask"]] as const).map(([t, ic]) => (
              <button key={t} type="button" onClick={() => setTab(t)} className="back-btn" style={{
                flex: 1, justifyContent: "center", gap: 6, padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: ".5px solid var(--bd)", background: tab === t ? "var(--posb)" : "#fff", color: tab === t ? "#fff" : "var(--tm)",
              }}><i className={`ti ${ic}`} /> {t}</button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
            {/* Daftar item */}
            <div>
              {tab === "Obat" && (
                <>
                  <div style={{ position: "relative", marginBottom: 8 }}>
                    <input className="fi" placeholder="Cari nama obat / scan barcode…" value={search} onChange={(e) => { setSearch(e.target.value); setObatPage(1); }} style={{ paddingRight: 28 }} />
                    <i className="ti ti-search" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 13 }} />
                  </div>
                  <div style={{ maxHeight: 340, overflowY: "auto", overflowX: "auto" }}>
                    <table className="tbl" style={{ minWidth: 260 }}>
                      <thead>
                        <tr><th>Nama Obat</th><th style={{ textAlign: "center" }}>Stok</th><th style={{ textAlign: "right" }}>Harga</th><th style={{ width: 32 }} /></tr>
                      </thead>
                      <tbody>
                        {filtered.map((it) => (
                          <tr key={it.id}>
                            <td style={{ fontSize: 11, fontWeight: 500 }}>{it.name}</td>
                            <td style={{ textAlign: "center", fontSize: 10.5, color: it.stok <= 0 ? "#b91c1c" : "var(--tm)" }}>{it.stok} {it.unit}</td>
                            <td style={{ textAlign: "right", fontSize: 11 }}>{rp(it.sell_price)}</td>
                            <td style={{ textAlign: "center" }}>
                              <button type="button" onClick={() => pickObat(it)} className="btn-acc" style={{ padding: "2px 7px", fontSize: 11, background: "#16a34a" }} title="Tambah"><i className="ti ti-plus" /></button>
                            </td>
                          </tr>
                        ))}
                        {filtered.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", fontSize: 11, color: "var(--td)", padding: "12px 0" }}>Tidak ada obat.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, fontSize: 10.5 }}>
                    <span>{obatMatches.length} obat · {currentObatPage}/{obatPages}</span>
                    <button type="button" className="btn-def" aria-label="Obat sebelumnya" disabled={currentObatPage <= 1} onClick={() => setObatPage(currentObatPage - 1)}>Sebelumnya</button>
                    <button type="button" className="btn-def" aria-label="Obat berikutnya" disabled={currentObatPage >= obatPages} onClick={() => setObatPage(currentObatPage + 1)}>Berikutnya</button>
                  </div>
                </>
              )}
              {(tab === "Jasa" || tab === "Tindakan") && (
                <>
                  <ClinicServicePicker key={tab} kind={tab} items={tab === "Jasa" ? jasaItems : tindakanItems} onAdd={tab === "Jasa" ? addObat : selectProcedure} />
                  {tab === "Tindakan" && procedureDraft && <ProcedureBmhpComposer name={procedureDraft.item.name} price={procedureDraft.editKey ? cart.find(row => row.key === procedureDraft.editKey)?.harga ?? procedureDraft.item.sell_price : procedureDraft.item.sell_price}
                    items={items} value={procedureDraft.bmhp} editing={!!procedureDraft.editKey}
                    onChange={bmhp => setProcedureDraft(draft => draft ? { ...draft, bmhp } : draft)}
                    onCommit={commitProcedure} onCancel={() => { setProcedureDraft(null); setProcedureError(""); }} />}
                </>
              )}
              {tab === "Racikan" && (
                // K03: racikan rawat jalan harus lewat komposisi; jangan tampilkan jalan pintas stok obat jadi.
                <CompoundEditor items={racikanItems} materials={bahanItems} catalog={katalogRacikan} allowCustom={bolehManual}
                  value={compoundDraft} onChange={changeCompound} onAdd={addRacikanToCart} />
              )}
            </div>

            {/* Keranjang */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)" }}>KERANJANG ({cart.length})</span>
                {cart.length > 0 && <button type="button" onClick={clear} className="back-btn" style={{ fontSize: 10, color: "#b91c1c" }}>Hapus semua</button>}
              </div>
              <div style={{ minHeight: 60, overflowX: "auto" }}>
                {cart.length === 0 ? (
                  <div style={{ fontSize: 10.5, color: "var(--td)", padding: "8px 0" }}>Belum ada item. Tambah obat/jasa dari kiri.</div>
                ) : (
                  <table className="tbl" style={{ minWidth: 300 }}>
                    <thead>
                      <tr><th>Nama</th><th style={{ textAlign: "center", width: 48 }}>Qty</th><th style={{ textAlign: "right" }}>Subtotal</th><th style={{ width: 26 }} /></tr>
                    </thead>
                    <tbody>
                      {cart.map((r) => (
                        <tr key={r.key}>
                          <td style={{ fontSize: 10.5 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              {r.jenis === "racikan" && (
                                <i className={`ti ti-chevron-${expanded[r.key] ? "down" : "right"}`} style={{ cursor: "pointer", fontSize: 12, color: "var(--tm)" }}
                                  onClick={() => setExpanded((e) => ({ ...e, [r.key]: !e[r.key] }))} />
                              )}
                              <span>{r.nama_obat}</span>
                              {r.jenis === "racikan" && <span className="bge b" style={{ fontSize: 8 }}>racikan</span>}
                            </div>
                            <div style={{ fontSize: 9, color: "var(--tm)", display: "flex", alignItems: "center", gap: 4 }}>
                              <span>{rp(r.harga)} /</span>
                              {unitsOf(r.item_id).length > 1 && r.jenis === "obat" ? (
                                <select className="fi" value={r.satuan} onChange={(e) => setSatuan(r.key, r.item_id, e.target.value)}
                                  style={{ width: 62, padding: "1px 3px", fontSize: 9.5 }} title="Satuan">
                                  {unitsOf(r.item_id).map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
                                </select>
                              ) : <span>{r.satuan}</span>}
                            </div>
                            <ClinicLineSellerField name={r.nama_obat} value={r.salesperson_id} staff={serviceStaff}
                              onChange={salesperson_id => setCart(rows => rows.map(row => row.key === r.key ? {...row, salesperson_id} : row))} />
                            {r.jenis === "jasa" && <ServicePerformersField label={`Pelaksana ${r.nama_obat}`} value={r.service_performers} staff={serviceStaff}
                              grooming={groomingApplies && (r.kategori === "Grooming" || [...jasaItems, ...tindakanItems].some(item => item.id === r.item_id && item.tindakan_kategori === "Grooming"))}
                              doctorRequired={groomingDoctorRequired}
                              onChange={value => setCart(rows => rows.map(row => row.key === r.key ? {...row, service_performers:value} : row))} />}
                            {r.jenis === "jasa" && r.item_id && tindakanItems.some(item => item.id === r.item_id) && <div style={{ fontSize: 10 }}>
                              <span>BMHP: {(r.bmhp ?? []).map(material => `${material.nama} × ${material.qty} ${material.unit}`).join(", ") || "belum diisi"}</span>{" "}
                              <button type="button" className="btn-def" aria-label={`Ubah BMHP ${r.nama_obat}`} onClick={() => editProcedure(r)}>Ubah BMHP</button>
                            </div>}
                            {/* BMHP is composed only for clinic procedures (TINDAKAN); other services keep any stored BMHP read-only. */}
                            {r.jenis === "jasa" && r.item_id && !tindakanItems.some(item => item.id === r.item_id) && (r.bmhp?.length ?? 0) > 0 && <div style={{ fontSize: 10 }}>
                              BMHP tersimpan: {r.bmhp!.map(material => `${material.nama} × ${material.qty} ${material.unit}`).join(", ")}
                            </div>}
                            {r.jenis === "racikan" && expanded[r.key] && (
                              <div style={{ marginTop: 4, paddingLeft: 14, borderLeft: "2px solid var(--bd)" }}>
                                {(r.ingredients ?? []).map((b) => (
                                  <div key={b.item_id} style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 9, color: "var(--tm)" }}>
                                    <span>{b.nama} × {b.qty} {b.satuan}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            {r.jenis === "racikan"
                              ? <span style={{ fontSize: 10.5 }}>1</span>
                              : <NumberInput className="fi" type="number" min={1} value={r.qty} onChange={(e) => setQty(r.key, Number(e.target.value))} style={{ width: 42, padding: "2px 4px", textAlign: "center", fontSize: 10.5 }} />}
                          </td>
                          <td style={{ textAlign: "right", fontSize: 10.5, fontWeight: 600 }}>{rp(r.qty * r.harga)}</td>
                          <td style={{ textAlign: "center" }}>
                            <i className="ti ti-x" onClick={() => del(r.key)} style={{ cursor: "pointer", color: "#dc2626", fontSize: 13 }} title="Hapus" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {hasRacikan && (
                <div style={{ marginTop: 10 }}>
                  <label className="flab">Catatan resep (aturan pakai) · racikan</label>
                  <textarea className="fi" rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. Puyer 3x sehari 1 bungkus…" style={{ resize: "vertical" }} />
                </div>
              )}

              {cart.some(row => row.jenis === "jasa") && <div>
                <ServicePerformersField label="Isi pelaksana jasa sekaligus" value={bulkPerformers} staff={serviceStaff} onChange={setBulkPerformers} />
                <button type="button" className="btn-def" onClick={() => setCart(rows => bulkFillServicePerformers(rows, bulkPerformers))}>Isi baris jasa kosong</button>
                <p style={{fontSize:10}}>Baris yang sudah memiliki pelaksana tetap mengikuti pilihannya.</p>
              </div>}
              <div style={{ marginTop: 10, borderTop: ".5px solid var(--bd)", paddingTop: 8 }}>
                <Row k="Subtotal" v={rp(subtotal)} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
                  <span style={{ fontSize: 11.5, color: "var(--tm)" }}>Diskon</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <NumberInput className="fi" type="number" min={0} max={100} value={discountPct || ""} onChange={(e) => setDiscountPct(Math.min(100, Math.max(0, Number(e.target.value))))} style={{ width: 54, padding: "3px 6px", textAlign: "right" }} />
                    <span style={{ fontSize: 11, color: "var(--tm)" }}>%</span>
                    <span style={{ fontSize: 11, width: 72, textAlign: "right", color: "#b91c1c" }}>{discountVal > 0 ? `-${rp(discountVal)}` : rp(0)}</span>
                  </span>
                </div>
                <Row k="PPN (0%)" v={rp(ppn)} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0 0", borderTop: "1px solid var(--bd)", marginTop: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>TOTAL</span>
                  <span style={{ fontSize: 17, fontWeight: 800, color: "var(--posb)" }}>{rp(total)}</span>
                </div>
                <div style={{ fontSize: 9, color: "var(--td)", marginTop: 6 }}>Harga & diskon final dikonfirmasi kasir di tahap pembayaran.</div>
              </div>
            </div>
          </div>
          </>}
        </div>
      </div>

      {correction ? <div className="card"><b>Tindak lanjut tersimpan</b><p>{correction.follow_up ?? "Tidak ada tindak lanjut."}</p></div> : <FollowUpTable name="follow_ups" value={followUps} onChange={setFollowUps} />}

      {correction && <div style={{ marginTop: 12 }}><label className="flab" htmlFor="correction-reason">Alasan koreksi *</label><textarea id="correction-reason" className="fi" name="correction_reason" required minLength={3} maxLength={1000} /></div>}
      {/* Aksi */}
      {correction ? <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button type="button" className="btn-def" onClick={() => { draftDiscard(); router.push(`/klinik/rekam-medis/${visitId}`); }}>Batal</button>
        <SubmitButton className="btn-acc" pendingText="Menyimpan…">Simpan koreksi</SubmitButton>
      </div> : <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <SubmitButton className="btn-acc" icon="ti-printer" name="next" value="resep" style={{ padding: "10px 20px", fontSize: 13 }} pendingText="Menyimpan…">Simpan &amp; Cetak Resep</SubmitButton>
        <SubmitButton className="btn-acc" icon="ti-bed" name="next" value="rawatinap" style={{ padding: "10px 20px", fontSize: 13 }} pendingText="Menyimpan…">Simpan &amp; Lanjut Rawat Inap</SubmitButton>
      </div>}
    </form>
  );
}

function MiniKV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 5 }}>
      <span style={{ color: "var(--tm)", minWidth: 62 }}>{k}</span>
      <span style={{ color: "var(--tx)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>: {v}</span>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11.5 }}>
      <span style={{ color: "var(--tm)" }}>{k}</span>
      <span style={{ fontWeight: 500 }}>{v}</span>
    </div>
  );
}
