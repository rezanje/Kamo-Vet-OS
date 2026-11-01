"use client";

import { NumberInput } from "@/components/NumberInput";
import { QtyInput } from "@/components/QtyInput";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClinicalCorrection } from "@/lib/clinical-correction";
import Link from "next/link";
import { ServicePerformersField } from "@/components/ServicePerformersField";
import { TindakanRacikanForm } from "@/components/TindakanRacikanForm";
import { VaksinasiDariVial } from "@/components/VaksinasiDariVial";
import { KeranjangBahan } from "@/components/KeranjangBahan";
import { vaccinationBmhp, vaccinationOf, type BmhpRow } from "@/lib/procedure-bmhp";
import { bulkFillServicePerformers, emptyServicePerformers, servicePerformerNames, visitDefaultPerformers, type ServicePerformersInput, type ServiceStaff } from "@/lib/service-performers";
import { useClinicDraft } from "@/components/useClinicDraft";
import { SubmitButton } from "@/components/SubmitButton";
import { kekuranganStok } from "@/lib/stok-keranjang";
import { petaStokKlinik } from "@/lib/stok-klinik";
import { StokKlinik, StokKeranjangKlinik } from "@/components/StokKlinik";
import { StokKurangPopup, StokKurangDariPesan } from "@/components/StokKurangPopup";
import type { BarisKurangStok } from "@/lib/stok-kurang";
import { simpanRekamMedis, koreksiRekamMedis, koreksiRekamMedisLengkap } from "./actions";
import { type RacikanIngredient } from "@/lib/racikan";
import { PenunjangUpload } from "@/components/PenunjangUpload";
import { PetPhotoUpload } from "@/components/PetPhotoUpload";
import { FollowUpTable, type FollowUpDraft } from "@/components/FollowUpTable";
import { ClinicServicePicker } from "@/components/ClinicServicePicker";
import { pickUnit, type ItemUnit } from "@/lib/satuan";
import { batasBeratWajar } from "@/lib/anabul";
import { type KatalogRacikan } from "@/lib/katalog-racikan";
import { masterCompoundCartRow, type CompoundDraft } from "@/lib/master-compound-cart";
import { staffForService } from "@/lib/clinical-staff";
import { isMedicalService } from "@/lib/clinic-required-fields";

export type ItemLite = {
  id: string; code?: string | null; upc?: string | null; name: string; unit: string; sell_price: number;
  /** Stok satuan dasar gudang klinik transaksi; null = belum terbaca. */
  stok: number | null;
  tindakan_kategori?: string | null; item_type?: string;
  units?: ItemUnit[];   // satuan berjenjang (pcs/box, ml/btl) — kosong = hanya satuan dasar
};
type CartRow = {
  prescription_item_id?: string;
  key: string; item_id: string | null; nama_obat: string; qty: number; satuan: string; harga: number;
  faktor: number;
  jenis: "obat" | "jasa" | "racikan";
  kategori?: string;
  ingredients?: RacikanIngredient[]; dosage_form?: string; aturan_pakai?: string;
  official_version_id?: string;
  sale_item_id?: string;
  service_performers?: ServicePerformersInput | null;
  /** K02: actual consumables on a procedure row (optional). */
  bmhp?: BmhpRow[];
  /** Diisi hanya bila racikan sudah pernah diracik (stok bahan sudah keluar). */
  compound_recipe_id?: string;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

/** Tindakan dan racikan dikerjakan dari satu tab (permintaan Andri). */
const TINDAKAN = "Tindakan & Racikan";
const TABS = [["Obat", "ti-pill"], ["Jasa", "ti-stethoscope"], [TINDAKAN, "ti-package"]] as const;
type Tab = (typeof TABS)[number][0];

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

export function RekamForm({ visitId, petId, requestKey, draftUserId, patient, items, racikanItems, bahanItems, jasaItems, tindakanItems, katalogRacikan, bolehManual, currentWeight, dokterOpsi, providerOpsi, service, serviceStaff = [], groomingDoctorRequired = false, groomingApplies = true, correction, tabAwal }: {
  correction?: ClinicalCorrection;
  /** `?tab=tindakan` membuka form langsung di tab "Tindakan & Racikan" — dipakai tombol
   * "Tambah tindakan / obat" di Detail rekam medis. Nilai lain tetap mulai dari "Obat". */
  tabAwal?: string;
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
  // Tab "Tindakan & Racikan" menggabungkan pemilihan tindakan (beserta komposisi BMHP)
  // dengan peracikan; tab Jasa tetap murni jasa dan tidak pernah menampilkan BMHP.
  const [tab, setTab] = useState<Tab>(tabAwal === "tindakan" ? TINDAKAN : "Obat");
  const [search, setSearch] = useState("");
  const [obatPage, setObatPage] = useState(1);
  const [cart, setCart] = useState<CartRow[]>(() => correction?.fullEdit ? correction.prescriptions.map((row, index) => ({
    key: row.id ?? `saved-${index}`, prescription_item_id: row.id, item_id: row.item_id ?? null,
    nama_obat: row.nama_obat, qty: Number(row.qty), satuan: row.satuan ?? "pcs", harga: Number(row.harga ?? 0), faktor: Number(row.faktor ?? 1),
    jenis: row.compound_recipe_id ? "racikan" : row.jenis === "jasa" ? "jasa" : "obat",
    kategori: row.kategori ?? undefined, aturan_pakai: row.aturan_pakai ?? undefined,
    compound_recipe_id: row.compound_recipe_id ?? undefined, service_performers: row.service_performers,
    bmhp: row.bmhp_components?.map(material => ({...material,nama:material.name ?? material.item_id})),
  })) : []);
  const [procedureDraft, setProcedureDraft] = useState<{ item: ItemLite; bmhp: BmhpRow[]; editKey: string | null } | null>(null);
  const [procedureError, setProcedureError] = useState("");
  const procedureCommitted = useRef(false);
  // Dokter PJ kunjungan jadi isian awal kolom Dokter tiap baris. Dibaca dari DOM supaya
  // pemulihan draf (yang menulis langsung ke kontrol) tetap jadi acuan.
  const dokterPjRef = useRef<HTMLSelectElement>(null);
  const barisDefault = () => visitDefaultPerformers(dokterPjRef.current?.value ?? patient.dokterId);
  const [bulkPerformers, setBulkPerformers] = useState(emptyServicePerformers);
  const [catatan, setCatatan] = useState("");
  const [discountPct, setDiscountPct] = useState(0);
  const [stokKurang, setStokKurang] = useState<BarisKurangStok[]>([]);

  // Builder racikan
  const [racikNama, setRacikNama] = useState("");
  const [saleItemId, setSaleItemId] = useState("");
  const [officialVersionId, setOfficialVersionId] = useState("");
  const [racikForm, setRacikForm] = useState("sirup");
  const [racikAturan, setRacikAturan] = useState("");
  const [racikBahan, setRacikBahan] = useState<RacikanIngredient[]>([]);
  const [racikanEditKey, setRacikanEditKey] = useState<string | null>(null);

  const [followUps, setFollowUps] = useState<FollowUpDraft[]>([]);
  const [penunjangPaths, setPenunjangPaths] = useState<string[]>(correction?.penunjang_urls ?? []);
  const {
    attachForm: draftAttachForm, submissionKey: draftSubmissionKey, recovered: draftRecovered,
    storageError: draftStorageError, saveError: draftSaveError,
    capture: draftCapture, discard: draftDiscard, submit: draftSubmit, leaving: draftLeaving,
  } = useClinicDraft({
    userId: draftUserId, scope: correction ? `correction:${visitId}:${correction.recordId}:v${correction.revision}` : `exam:${visitId}`, requestKey,
    optionalSnapshotKeys: ["saleItemId", "procedureDraft", "racikanEditKey"],
    snapshot: { saleItemId, cart, procedureDraft, racikanEditKey, catatan, discountPct, racikNama, officialVersionId, racikForm, racikAturan, racikBahan, followUps, penunjangPaths },
    restore: (value) => {
      setCart(value.cart);
      setProcedureDraft(value.procedureDraft ?? null);
      setRacikanEditKey(value.racikanEditKey ?? null);
      if (value.procedureDraft || value.saleItemId) setTab(TINDAKAN);
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
  const resetRacikan = () => {
    setSaleItemId(""); setOfficialVersionId(""); setRacikNama(""); setRacikForm("sirup"); setRacikAturan(""); setRacikBahan([]);
    setRacikanEditKey(null);
  };
  /** Racikan baru maupun baris keranjang yang diubah memakai bentuk baris yang sama persis. */
  const addRacikanToCart = () => {
    const sku = racikanItems.find(item => item.id === saleItemId) ?? null;
    let dibuat;
    try { dibuat = masterCompoundCartRow(sku, selectedFormula ?? null, compoundDraft, racikanEditKey ?? crypto.randomUUID(), bolehManual); }
    catch (error) { setProcedureError(error instanceof Error ? error.message : "Racikan belum lengkap"); return; }
    const baris = dibuat; // konstan supaya bisa dipakai di dalam penutup setCart
    setCart(rows => racikanEditKey
      ? rows.map(line => line.key === racikanEditKey ? { ...baris, service_performers: line.service_performers } : line)
      : [...rows, { ...baris, service_performers: barisDefault() }]);
    resetRacikan();
    setProcedureError("");
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
      const isService = it.item_type === "Jasa";
      // Tiap tindakan ber-BMHP berdiri sendiri: komposisinya bisa berbeda per baris.
      const ex = isService || bmhp ? undefined : c.find((r) => r.item_id === it.id && r.jenis !== "jasa");
      if (ex) return c.map((r) => (r.item_id === it.id ? { ...r, qty: r.qty + 1 } : r));
      const u = isService ? undefined : (it.units ?? [])[0];
      return [...c, {
        key: isService || bmhp ? crypto.randomUUID() : it.id, item_id: it.id, nama_obat: it.name, qty: 1,
        satuan: u?.unit ?? it.unit, harga: u?.sell_price ?? it.sell_price, faktor: u?.factor ?? 1, jenis: isService ? "jasa" : "obat",
        kategori: isService ? it.tindakan_kategori ?? undefined : undefined,
        service_performers: barisDefault(),
        ...(bmhp ? { bmhp } : {}),
      }];
    });
  };
  const selectProcedure = (item: ItemLite): void => {
    // Tindakan jasa maupun persediaan sama-sama membuka komposisi BMHP; hanya vial vaksin
    // yang tetap dialihkan ke jasa vaksinasinya sendiri.
    const vaccination = item.item_type !== "Jasa" ? vaccinationOf(item, tindakanItems) : undefined;
    const picked = vaccination ?? item;
    setTab(TINDAKAN);
    if (procedureDraft?.item.id === picked.id && !procedureDraft.editKey) return;
    procedureCommitted.current = false;
    setProcedureError("");
    resetRacikan();
    setProcedureDraft({ item: picked, bmhp: vaccinationBmhp(picked, [...items, ...tindakanItems]), editKey: null });
  };
  /** Racikan dipilih dari pemilih yang sama dengan tindakan; hanya satu yang aktif. */
  const selectRacikan = (item: ItemLite): void => {
    setTab(TINDAKAN);
    setProcedureDraft(null);
    setProcedureError("");
    if (saleItemId === item.id && !racikanEditKey) return;
    setRacikanEditKey(null);
    setSaleItemId(item.id); setRacikNama(item.name);
    setOfficialVersionId(""); setRacikForm("sirup"); setRacikAturan(""); setRacikBahan([]);
  };
  const pickObat = (it: ItemLite): void => {
    const vaccination = vaccinationOf(it, tindakanItems);
    return vaccination ? selectProcedure(vaccination) : addObat(it);
  };
  const editProcedure = (row: CartRow) => {
    const item = tindakanItems.find(candidate => candidate.id === row.item_id) ?? {
      id: row.item_id!, name: row.nama_obat, unit: row.satuan, sell_price: row.harga,
      stok: null, item_type: row.jenis === "jasa" ? "Jasa" : "Persediaan", tindakan_kategori: row.kategori,
    };
    procedureCommitted.current = false;
    setProcedureError("");
    setProcedureDraft({ item, bmhp: [...(row.bmhp ?? [])], editKey: row.key });
    setTab(TINDAKAN);
  };
  const editRacikan = (row: CartRow) => {
    setProcedureDraft(null);
    setProcedureError("");
    setSaleItemId(row.sale_item_id ?? ""); setRacikNama(row.nama_obat);
    setOfficialVersionId(row.official_version_id ?? "");
    setRacikForm(row.dosage_form ?? "sirup"); setRacikAturan(row.aturan_pakai ?? "");
    setRacikBahan([...(row.ingredients ?? [])]);
    setRacikanEditKey(row.key);
    setTab(TINDAKAN);
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
  const del = (key: string) => {
    setCart((c) => c.filter((r) => r.key !== key));
    if (procedureDraft?.editKey === key) setProcedureDraft(null);
    if (racikanEditKey === key) resetRacikan();
  };
  const clear = () => { setCart([]); setProcedureDraft(null); resetRacikan(); };
  // Satu form: tindakan dan racikan memakai tombol simpan/batal yang sama.
  const formItem = procedureDraft?.item ?? racikanItems.find(item => item.id === saleItemId) ?? null;
  const formEditKey = procedureDraft ? procedureDraft.editKey : racikanEditKey;
  const formHarga = (formEditKey ? cart.find(row => row.key === formEditKey)?.harga : undefined) ?? formItem?.sell_price ?? 0;
  const commitForm = () => (procedureDraft ? commitProcedure() : addRacikanToCart());
  const cancelForm = () => { setProcedureDraft(null); resetRacikan(); setProcedureError(""); };

  // ponytail: catatan resep hanya relevan untuk SKU racikan
  const hasRacikan = cart.some((r) => r.jenis === "racikan");

  const subtotal = cart.reduce((a, r) => a + r.qty * r.harga, 0);
  const discountVal = Math.round((subtotal * discountPct) / 100);
  const ppn = 0; // ponytail: PPN 0% (display); tarif final ditentukan kasir saat pembayaran
  const total = Math.max(0, subtotal - discountVal + ppn);

  // Peta stok gudang transaksi. Pemeriksaan sebelum simpan tetap memakai cakupan lama;
  // tampilan keranjang juga mengenal tindakan persediaan (stok induk tanpa BMHP).
  const stokById = useMemo(() => petaStokKlinik(items, bahanItems, racikanItems), [items, bahanItems, racikanItems]);
  const stokTampil = useMemo(() => petaStokKlinik(items, bahanItems, racikanItems, tindakanItems), [items, bahanItems, racikanItems, tindakanItems]);

  return (<>
    {/* Di luar <form>: dialog punya form method="dialog" sendiri. */}
    <StokKurangPopup baris={stokKurang} onClose={() => setStokKurang([])}
      petunjuk="Kurangi jumlahnya atau ganti dengan obat lain yang stoknya ada." />
    {/* Penolakan dari database (mis. stok habis dipakai kasir lain sedetik lalu)
        bermuara ke popup yang sama. Hanya satu dialog yang boleh terbuka. */}
    {stokKurang.length === 0 && <StokKurangDariPesan pesan={draftSaveError}
      petunjuk="Kurangi jumlahnya atau ganti dengan obat lain yang stoknya ada." />}
    <form ref={draftAttachForm} action={(data) => draftSubmit(data, correction?.fullEdit ? koreksiRekamMedisLengkap : correction ? koreksiRekamMedis : simpanRekamMedis)} onInputCapture={draftCapture} onChangeCapture={draftCapture} onSubmitCapture={event => {
      const kurang = correction ? [] : kekuranganStok(cart, stokById, (id, unit) => unitsOf(id).find(u => u.unit === unit)?.factor ?? 1);
      if (procedureDraft || saleItemId) { event.preventDefault(); event.stopPropagation(); setTab(TINDAKAN); setProcedureError("Selesaikan form tindakan / racikan: tambahkan ke keranjang atau batalkan sebelum menyimpan."); }
      else if (kurang.length) { event.preventDefault(); event.stopPropagation(); setStokKurang(kurang); }
      else draftCapture();
    }}>
      {draftRecovered && <div role="status" className="p2ban">Draf dipulihkan <button type="button" className="btn-def" onClick={draftDiscard}>Buang draf</button></div>}
      {procedureError && <div role="alert" className="p2ban">{procedureError}</div>}
      {(draftStorageError || draftSaveError) && <div role="alert" className="p2ban">{draftSaveError || draftStorageError}</div>}
      {correction && <div className="p2ban">{correction.fullEdit ? "Edit owner / dokter sebelum tagihan terbit: obat, jasa, tindakan dan BMHP. Baris tersimpan tidak dihapus. Racikan yang sudah dibuat dikoreksi melalui Aksi racikan; bahan tidak dikeluarkan ulang. Data pasien dan tindak lanjut tetap mengikuti pemeriksaan tersimpan." : "Koreksi catatan klinis. Resep, racikan, tindak lanjut, dan data pasien tetap mengikuti pemeriksaan tersimpan."}</div>}
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
                  <select className="fi" name="doctor_id" ref={dokterPjRef} disabled={!!correction} required={isMedicalService(service)} defaultValue={patient.dokterId ?? ""}
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

          {correction && !correction.fullEdit ? <>
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
            {TABS.map(([t, ic]) => (
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
                            <td style={{ fontSize: 11, fontWeight: 500 }}>{it.name}<VaksinasiDariVial item={it} services={tindakanItems} /></td>
                            <td style={{ textAlign: "center" }}><StokKlinik stok={it.stok} satuanDasar={it.unit} style={{ fontSize: 10.5 }} /></td>
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
              {tab === "Jasa" && (
                <ClinicServicePicker key={tab} kind="Jasa" items={jasaItems} onAdd={addObat} />
              )}
              {/* K03: racikan rawat jalan tetap harus lewat komposisi; tidak ada jalan pintas stok obat jadi. */}
              {tab === TINDAKAN && (
                <TindakanRacikanForm tindakanItems={tindakanItems} racikanItems={correction?.fullEdit ? [] : racikanItems} bmhpItems={items} bahanItems={bahanItems}
                  katalogRacikan={katalogRacikan} bolehManual={bolehManual}
                  tindakan={procedureDraft} racikan={compoundDraft} editing={!!formEditKey} harga={formHarga}
                  onPilihTindakan={selectProcedure} onPilihRacikan={selectRacikan}
                  onUbahBmhp={bmhp => setProcedureDraft(draft => draft ? { ...draft, bmhp } : draft)}
                  onUbahRacikan={changeCompound} onSimpan={commitForm} onBatal={cancelForm} />
              )}
            </div>

            {/* Keranjang */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)" }}>KERANJANG ({cart.length})</span>
                {cart.length > 0 && !correction?.fullEdit && <button type="button" onClick={clear} className="back-btn" style={{ fontSize: 10, color: "#b91c1c" }}>Hapus semua</button>}
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
                            {/* Item utama ditebalkan; pelaksana & bahan jadi rincian kecil di bawahnya. */}
                            <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                              <strong data-cart-item style={{ fontSize: 12.5, fontWeight: 700, color: "var(--tx)" }}>{r.nama_obat}</strong>
                              {correction?.fullEdit && !r.compound_recipe_id && <select className="fi" aria-label={`Ganti item ${r.nama_obat}`} value={r.item_id ?? ""} onChange={event => {
                                const item = [...items, ...jasaItems, ...tindakanItems].find(item => item.id === event.target.value);
                                if (item) setCart(rows => rows.map(row => row.key === r.key ? {...row,item_id:item.id,nama_obat:item.name,satuan:item.unit,faktor:1,harga:item.sell_price,jenis:item.item_type === "Jasa" ? "jasa" : "obat",kategori:item.tindakan_kategori ?? undefined,bmhp:[]} : row));
                              }}><option value={r.item_id ?? ""}>{r.nama_obat}</option>{[...items,...jasaItems,...tindakanItems].filter(item=>item.id!==r.item_id).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}
                              {r.jenis === "racikan" && <span className="bge b" style={{ fontSize: 8 }}>racikan</span>}
                              <span style={{ fontSize: 9, color: "var(--tm)", display: "flex", alignItems: "center", gap: 4 }}>
                                {rp(r.harga)} /
                                {unitsOf(r.item_id).length > 1 && r.jenis === "obat" ? (
                                  <select className="fi" value={r.satuan} onChange={(e) => setSatuan(r.key, r.item_id, e.target.value)}
                                    style={{ width: 62, padding: "1px 3px", fontSize: 9.5 }} title="Satuan">
                                    {unitsOf(r.item_id).map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
                                  </select>
                                ) : <span>{r.satuan}</span>}
                              </span>
                            </div>
                            <StokKeranjangKlinik baris={r} peta={stokTampil} />
                            {!r.prescription_item_id && <ServicePerformersField compact label={`Pelaksana ${r.nama_obat}`} value={r.service_performers} staff={serviceStaff}
                              grooming={groomingApplies && r.jenis === "jasa" && (r.kategori === "Grooming" || [...jasaItems, ...tindakanItems].some(item => item.id === r.item_id && item.tindakan_kategori === "Grooming"))}
                              doctorRequired={groomingDoctorRequired}
                              onChange={value => setCart(rows => rows.map(row => row.key === r.key ? {...row, service_performers:value} : row))} />}
                            {r.jenis !== "racikan" && r.item_id && tindakanItems.some(item => item.id === r.item_id) &&
                              <KeranjangBahan nada="bmhp" judul="BMHP" kosong="belum diisi"
                                baris={(r.bmhp ?? []).map(material => `${material.nama} × ${material.qty} ${material.unit}`)}>
                                <button type="button" className="btn-def" aria-label={`Ubah BMHP ${r.nama_obat}`}
                                  style={{ marginTop: 3, padding: "1px 7px", fontSize: 9.5 }} onClick={() => editProcedure(r)}>Ubah BMHP</button>
                              </KeranjangBahan>}
                            {/* BMHP is composed only for clinic procedures (TINDAKAN); other services keep any stored BMHP read-only. */}
                            {r.jenis === "jasa" && r.item_id && !tindakanItems.some(item => item.id === r.item_id) && (r.bmhp?.length ?? 0) > 0 &&
                              <KeranjangBahan nada="bmhp" judul="BMHP tersimpan"
                                baris={r.bmhp!.map(material => `${material.nama} × ${material.qty} ${material.unit}`)} />}
                            {r.jenis === "racikan" &&
                              <KeranjangBahan nada="racikan" judul="Bahan racikan" kosong="belum diisi"
                                baris={(r.ingredients ?? []).map(b => `${b.nama} × ${b.qty} ${b.satuan}`)}>
                                {r.compound_recipe_id
                                  ? <div style={{ fontSize: 9.5, color: "#b91c1c" }}>Sudah diracik — bahannya diubah lewat{" "}
                                    <Link href={`/klinik/racik/${r.compound_recipe_id}`}>Aksi → Ubah komposisi</Link> supaya stok tidak keluar dua kali.</div>
                                  : <button type="button" className="btn-def" aria-label={`Ubah bahan ${r.nama_obat}`}
                                    style={{ marginTop: 3, padding: "1px 7px", fontSize: 9.5 }} onClick={() => editRacikan(r)}>Ubah bahan</button>}
                              </KeranjangBahan>}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            {r.jenis === "racikan"
                              ? <span style={{ fontSize: 10.5 }}>1</span>
                              : <QtyInput className="fi" min={1} aria-label={`Jumlah ${r.nama_obat}`} value={r.qty} onValue={(n) => setQty(r.key, n)} style={{ width: 42, padding: "2px 4px", textAlign: "center", fontSize: 10.5 }} />}
                          </td>
                          <td style={{ textAlign: "right", fontSize: 10.5, fontWeight: 600 }}>{rp(r.qty * r.harga)}</td>
                          <td style={{ textAlign: "center" }}>
                            {!r.prescription_item_id && <i className="ti ti-x" onClick={() => del(r.key)} style={{ cursor: "pointer", color: "#dc2626", fontSize: 13 }} title="Hapus" />}
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

              {cart.length > 0 && <div>
                <ServicePerformersField label="Isi pelaksana sekaligus" value={bulkPerformers} staff={serviceStaff} onChange={setBulkPerformers} />
                <button type="button" className="btn-def" onClick={() => setCart(rows => bulkFillServicePerformers(rows, bulkPerformers))}>Isi baris kosong</button>
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
        <SubmitButton className="btn-acc" pendingText="Menyimpan…" busy={draftLeaving}>Simpan koreksi</SubmitButton>
      </div> : <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <SubmitButton className="btn-acc" icon="ti-printer" name="next" value="resep" style={{ padding: "10px 20px", fontSize: 13 }} pendingText="Menyimpan…" busy={draftLeaving}>Simpan &amp; Cetak Resep</SubmitButton>
        <SubmitButton className="btn-acc" icon="ti-bed" name="next" value="rawatinap" style={{ padding: "10px 20px", fontSize: 13 }} pendingText="Menyimpan…" busy={draftLeaving}>Simpan &amp; Lanjut Rawat Inap</SubmitButton>
      </div>}
    </form>
  </>);
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
