"use client";

import { NumberInput } from "@/components/NumberInput";
import { QtyInput } from "@/components/QtyInput";

import { useMemo, useRef, useState } from "react";
import { ServicePerformersField } from "@/components/ServicePerformersField";
import { TindakanRacikanForm } from "@/components/TindakanRacikanForm";
import { KeranjangBahan } from "@/components/KeranjangBahan";
import { vaccinationBmhp, vaccinationOf, type BmhpRow } from "@/lib/procedure-bmhp";
import { bulkFillServicePerformers, emptyServicePerformers, visitDefaultPerformers, type ServicePerformersInput, type ServiceStaff } from "@/lib/service-performers";
import { useClinicDraft } from "@/components/useClinicDraft";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient } from "@/lib/supabase/client";
import { type RacikanIngredient } from "@/lib/racikan";
import { OPSI_MAKAN, OPSI_MINUM, OPSI_BAB, OPSI_PIPIS, OPSI_KOMUNIKASI } from "@/lib/monitoring-inap";
import { pickUnit, type ItemUnit } from "@/lib/satuan";
import { addDailyLogPos, addInpatientBillables } from "../../actions";
import { type KatalogRacikan } from "@/lib/katalog-racikan";
import { ClinicServicePicker } from "@/components/ClinicServicePicker";
import { kekuranganStok } from "@/lib/stok-keranjang";
import { StokKurangPopup, StokKurangDariPesan } from "@/components/StokKurangPopup";
import type { BarisKurangStok } from "@/lib/stok-kurang";
import { masterCompoundCartRow, type CompoundDraft } from "@/lib/master-compound-cart";
import { InpatientStaffFields } from '@/components/InpatientStaffFields';
import type { ClinicalStaff, InpatientStaff } from '@/lib/clinical-staff';

/** U07: satuan yang dikirim ke browser — tanpa harga beli (tidak dipakai form klinik). */
export type UnitLite = Omit<ItemUnit, "buy_price">;
export type ItemLite = { id: string; code?: string | null; upc?: string | null; name: string; unit: string; sell_price: number; stok: number; item_type?: string; tindakan_kategori?: string | null; units?: UnitLite[] };
type CartRow = {
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
const TABS = [
  { id: "Obat", icon: "ti-capsule" },
  { id: "Jasa", icon: "ti-stethoscope" },
  { id: TINDAKAN, icon: "ti-gift" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function CatatanForm({ mode = "legacy", recordId, requestKey, draftUserId, backHref, patient, items, racikanItems, bahanItems, jasaItems, tindakanItems, katalogRacikan, bolehManual, doctors=[],paramedics=[], serviceStaff = [], visitDoctorId = null, groomingDoctorRequired = false, groomingApplies = true, petHotel = false, tabAwal }: {
  mode?: "legacy" | "clinical" | "billables";
  recordId: string; requestKey: string; draftUserId: string; backHref: string;
  /** `?tab=tindakan` membuka form langsung di tab "Tindakan & Racikan" — dipakai tombol
   * "Tambah tindakan / obat" di Detail rekam medis. Nilai lain tetap mulai dari "Obat". */
  tabAwal?: string;
  /** Dokter PJ kunjungan — isian awal kolom Dokter pada setiap baris. */
  visitDoctorId?: string | null;
  patient: { name: string; species: string; breed: string | null; noRM: string; owner: string; phone: string; address: string; tglMasuk: string; dokter: string; kondisi: string; photo: string | null };
  items: ItemLite[];
  racikanItems: ItemLite[];
  bahanItems: ItemLite[];
  jasaItems: ItemLite[];
  tindakanItems: ItemLite[];
  katalogRacikan: KatalogRacikan[];
  bolehManual: boolean;
  doctors?:ClinicalStaff[];paramedics?:ClinicalStaff[];
  serviceStaff?: ServiceStaff[];
  groomingDoctorRequired?: boolean;
  groomingApplies?: boolean;
  /** K14: pet hotel = catatan makan, kondisi, catatan bebas oleh paramedis; dokter/suhu tidak wajib. */
  petHotel?: boolean;
}) {
  const [staff,setStaff]=useState<InpatientStaff>({log_kind:'monitoring',visit_doctor_id:null,paramedic_id:null});
  const billables = mode === "billables";
  const [tab, setTab] = useState<Tab>(mode === "clinical" ? "Jasa" : tabAwal === "tindakan" ? TINDAKAN : "Obat");
  const [search, setSearch] = useState("");
  const [obatPage, setObatPage] = useState(1);
  const [cart, setCart] = useState<CartRow[]>([]);
  const [procedureDraft, setProcedureDraft] = useState<{ item: ItemLite; bmhp: BmhpRow[]; editKey: string | null } | null>(null);
  const [procedureError, setProcedureError] = useState("");
  const [stokKurang, setStokKurang] = useState<BarisKurangStok[]>([]);
  const procedureCommitted = useRef(false);
  const [bulkPerformers, setBulkPerformers] = useState(emptyServicePerformers);
  const [catatan, setCatatan] = useState("");
  const [discountPct, setDiscountPct] = useState(0);
  // Retain legacy draft fields so older snapshots still recover intact.
  const [jasaNama, setJasaNama] = useState("");
  const [jasaHarga, setJasaHarga] = useState(0);

  // Foto perkembangan pasien: diunggah dari sini supaya dokter/perawat tidak perlu
  // kirim lewat WA lalu ditempel manual belakangan.
  const [fotoUrl, setFotoUrl] = useState("");
  const [fotoPratinjau, setFotoPratinjau] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  async function pilihFoto(file: File | undefined) {
    if (!file) return;
    setFotoPratinjau(URL.createObjectURL(file));
    setUploading(true);
    setUploadErr("");
    try {
      const supabase = createClient();
      const path = `inap/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "-")}`;
      const { error } = await supabase.storage.from("pet-photos").upload(path, file, { upsert: true });
      if (error) throw error;
      setFotoUrl(supabase.storage.from("pet-photos").getPublicUrl(path).data.publicUrl);
    } catch (err) {
      // Pratinjau lokal tidak boleh ikut tersimpan — alamatnya mati begitu halaman ditutup.
      setFotoUrl("");
      setUploadErr(err instanceof Error ? err.message : "Gagal unggah foto");
    } finally {
      setUploading(false);
    }
  }

  // Builder racikan — alur & field sama seperti tab Racikan di form pemeriksaan.
  const [racikNama, setRacikNama] = useState("");
  const [saleItemId, setSaleItemId] = useState("");
  const [officialVersionId, setOfficialVersionId] = useState("");
  const [racikForm, setRacikForm] = useState("sirup");
  const [racikAturan, setRacikAturan] = useState("");
  const [racikBahan, setRacikBahan] = useState<RacikanIngredient[]>([]);
  const [racikanEditKey, setRacikanEditKey] = useState<string | null>(null);

  const {
    attachForm: draftAttachForm, submissionKey: draftSubmissionKey, recovered: draftRecovered,
    storageError: draftStorageError, saveError: draftSaveError,
    capture: draftCapture, discard: draftDiscard, submit: draftSubmit, leaving: draftLeaving,
  } = useClinicDraft({
    userId: draftUserId, scope: billables ? `inpatient-billables:${recordId}` : `inpatient:${recordId}`, requestKey,
    optionalSnapshotKeys: ["saleItemId","staff","procedureDraft","racikanEditKey"],
    snapshot: { staff,saleItemId, cart, procedureDraft, racikanEditKey, catatan, discountPct, racikNama, officialVersionId, racikForm, racikAturan, racikBahan, fotoUrl, jasaNama, jasaHarga },
    restore: (value) => {
      setStaff(value.staff??{log_kind:'monitoring',visit_doctor_id:null,paramedic_id:null});
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
      setFotoUrl(value.fotoUrl);
      setJasaNama(value.jasaNama);
      setJasaHarga(value.jasaHarga);
    },
  });

  const obatMatches = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter(it => [it.name, it.code, it.upc].some(value => value?.toLowerCase().includes(term)));
  }, [items, search]);
  const obatPages = Math.max(1, Math.ceil(obatMatches.length / 40));
  const currentObatPage = Math.min(obatPage, obatPages);
  const filtered = obatMatches.slice((currentObatPage - 1) * 40, currentObatPage * 40);
  const selectedFormula = katalogRacikan.find((formula) => formula.version_id === officialVersionId);

  const addObat = (it: ItemLite, bmhp?: BmhpRow[]) => setCart((c) => {
    const isService = it.item_type === "Jasa";
    // Tiap tindakan ber-BMHP berdiri sendiri: komposisinya bisa berbeda per baris.
    const ex = isService || bmhp ? undefined : c.find((r) => r.item_id === it.id && r.jenis !== "jasa");
    if (ex) return c.map((r) => (r.item_id === it.id ? { ...r, qty: r.qty + 1 } : r));
    const u = isService ? undefined : (it.units ?? [])[0];
    return [...c, {
      key: isService || bmhp ? crypto.randomUUID() : it.id, item_id: it.id, nama_obat: it.name, qty: 1,
      satuan: u?.unit ?? it.unit, harga: u?.sell_price ?? it.sell_price, faktor: u?.factor ?? 1, jenis: isService ? "jasa" : "obat",
      kategori: isService ? it.tindakan_kategori ?? undefined : undefined,
        service_performers: visitDefaultPerformers(visitDoctorId),
        ...(bmhp ? { bmhp } : {}),
    }];
  });
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
      stok: 0, item_type: row.jenis === "jasa" ? "Jasa" : "Persediaan", tindakan_kategori: row.kategori,
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
      : [...rows, { ...baris, service_performers: visitDefaultPerformers(visitDoctorId) }]);
    resetRacikan();
    setProcedureError("");
  };

  const setQty = (key: string, qty: number) => setCart((c) => c.map((r) => (r.key === key ? { ...r, qty: Math.max(1, qty) } : r)));
  // Satuan berjenjang: ganti ml→btl, harga & faktor ikut satuan yang dipilih.
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

  const subtotal = cart.reduce((a, r) => a + r.qty * r.harga, 0);
  const discountVal = Math.round((subtotal * discountPct) / 100);
  const ppn = 0; // ponytail: PPN 0% (display); tarif final ditentukan kasir saat pembayaran
  const total = Math.max(0, subtotal - discountVal + ppn);

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  // Same pre-check as rekam medis: medicine lines and procedure BMHP (e.g. vaccine vials) against branch stock.
  const stokById = new Map([...items, ...bahanItems, ...racikanItems].filter(it => it.item_type !== "Jasa").map(it => [it.id, { stok: it.stok, unit: it.unit }]));

  return (<>
    <StokKurangPopup baris={stokKurang} onClose={() => setStokKurang([])}
      petunjuk="Kurangi jumlahnya atau ganti dengan obat lain yang stoknya ada." />
    {/* Penolakan dari database (mis. stok habis dipakai kasir lain sedetik lalu)
        bermuara ke popup yang sama. Hanya satu dialog yang boleh terbuka. */}
    {stokKurang.length === 0 && <StokKurangDariPesan pesan={draftSaveError}
      petunjuk="Kurangi jumlahnya atau ganti dengan obat lain yang stoknya ada." />}
    <form ref={draftAttachForm} action={(data) => draftSubmit(data, billables ? addInpatientBillables : addDailyLogPos)} onInputCapture={draftCapture} onChangeCapture={draftCapture} onSubmitCapture={event => {
      const kurang = kekuranganStok(cart, stokById, (id, unit) => unitsOf(id).find(u => u.unit === unit)?.factor ?? 1);
      if (billables && cart.filter(row => row.jenis === "racikan").length > 1) { event.preventDefault(); event.stopPropagation(); setProcedureError("Simpan satu racikan per penambahan. Obat / BMHP boleh beberapa baris; racikan berikutnya disimpan terpisah."); }
      else if (procedureDraft || saleItemId) { event.preventDefault(); event.stopPropagation(); setTab(TINDAKAN); setProcedureError("Selesaikan form tindakan / racikan: tambahkan ke keranjang atau batalkan sebelum menyimpan."); }
      else if (kurang.length) { event.preventDefault(); event.stopPropagation(); setStokKurang(kurang); }
      else draftCapture();
    }}>
      {draftRecovered && <div role="status" className="p2ban">Draf dipulihkan <button type="button" className="btn-def" onClick={draftDiscard}>Buang draf</button></div>}
      {procedureError && <div role="alert" className="p2ban">{procedureError}</div>}
      {(draftStorageError || draftSaveError) && <div role="alert" className="p2ban">{draftSaveError || draftStorageError}</div>}
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="request_key" value={draftSubmissionKey} />
      <input type="hidden" name="resep" value={JSON.stringify(cart)} />
      <input type="hidden" name="catatan_resep" value={catatan} />
      <input type="hidden" name="foto_url" value={fotoUrl} />

      <div className="grid2" style={{ alignItems: "start" }}>
        {/* ===== KIRI: data pasien + detail rawat inap ===== */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em", marginBottom: 12 }}>DATA PASIEN</div>
          <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
            <div style={{ width: 84, height: 84, borderRadius: 10, background: "var(--sf1)", border: ".5px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
              {patient.photo ? <img src={patient.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <i className="ti ti-paw" style={{ fontSize: 34, color: "var(--td)" }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: "var(--sb)" }}>{patient.name}</span>
                <span className="bge b">{patient.species}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 14px", marginTop: 6, fontSize: 10.5 }}>
                <MiniKV k="Pemilik" v={patient.owner} />
                <MiniKV k="No. RM" v={patient.noRM} />
                <MiniKV k="No. HP" v={patient.phone} />
                <MiniKV k="Jenis / Ras" v={patient.breed ? `${patient.species} / ${patient.breed}` : patient.species} />
                <MiniKV k="Alamat" v={patient.address} />
                <MiniKV k="Tanggal Masuk" v={patient.tglMasuk} />
                <MiniKV k="Kondisi" v={patient.kondisi} />
                <MiniKV k="Dokter PJ" v={patient.dokter || "—"} />
              </div>
            </div>
          </div>

          {billables ? <div className="p2ban">
            Obat / BMHP masuk tagihan pasien pada kunjungan yang sama, tanpa membuat Laporan Visit.
            <label className="flab">Alasan penambahan<input className="fi" name="entry_reason" required minLength={3} maxLength={1000} defaultValue="Penambahan obat / BMHP rawat inap" /></label>
            Protokol dan pemberian dosis tetap dicatat terpisah, tidak otomatis menambah tagihan.
            <div>Satu racikan per penyimpanan; obat dan tindakan / BMHP boleh beberapa baris.</div>
          </div> : <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 10px" }}>
            <i className="ti ti-clipboard-list" style={{ fontSize: 16, color: "var(--posb)" }} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--posb)" }}>DETAIL RAWAT INAP</span>
          </div>

          <div className="frow">
            <div>
              <label className="flab">Tanggal *</label>
              <input className="fi" type="date" name="log_date" defaultValue={todayStr} required />
            </div>
            <div>
              <label className="flab">Waktu *</label>
              <input className="fi" type="time" name="log_time" defaultValue={timeStr} required />
            </div>
          </div>
          {/* Pemantauan harian: dipisah jadi kolom sendiri supaya bisa dihitung &
              digrafikkan (permintaan Drh. Ilham). Kolom kosong = belum diperiksa,
              bukan "tidak ada" — bedanya penting untuk hitungan hari tanpa BAB. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 8px" }}>
            <i className="ti ti-activity-heartbeat" style={{ fontSize: 15, color: "#16a34a" }} />
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#16a34a" }}>PEMANTAUAN HARIAN</span>
            <span style={{ fontSize: 9.5, color: "var(--td)" }}>kosongkan yang belum diperiksa</span>
          </div>
          {!petHotel && <div className="frow">
            <div>
              <label className="flab">Berat badan (kg)</label>
              <NumberInput className="fi" type="number" name="berat" min={0} max={200} step="0.01" placeholder="mis. 12.5" />
            </div>
            <div>
              <label className="flab">Suhu tubuh (°C)</label>
              <NumberInput className="fi" type="number" name="suhu" min={25} max={45} step="0.1" placeholder="mis. 38.6" />
            </div>
          </div>}
          <div className="frow">
            <div>
              <label className="flab">Makan</label>
              <select className="fi" name="makan" defaultValue="">
                <option value="">— belum dinilai —</option>
                {OPSI_MAKAN.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            {!petHotel && <div>
              <label className="flab">Minum</label>
              <select className="fi" name="minum" defaultValue="">
                <option value="">— belum dinilai —</option>
                {OPSI_MINUM.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>}
          </div>
          {!petHotel && <div className="frow">
            <div>
              <label className="flab">BAB</label>
              <select className="fi" name="bab" defaultValue="">
                <option value="">— belum dinilai —</option>
                {OPSI_BAB.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">BAK (pipis)</label>
              <select className="fi" name="pipis" defaultValue="">
                <option value="">— belum dinilai —</option>
                {OPSI_PIPIS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>}

          <div className="fg">
            <label className="flab">Foto pasien hari ini</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 62, height: 62, borderRadius: 9, background: "var(--sf1)", border: ".5px solid var(--bd)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {fotoPratinjau || fotoUrl
                  ? <img src={fotoUrl || fotoPratinjau} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <i className="ti ti-camera" style={{ fontSize: 22, color: "var(--td)" }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <input type="file" accept="image/*" className="fi" style={{ fontSize: 10.5, padding: 5 }}
                  onChange={(e) => pilihFoto(e.target.files?.[0])} />
                <div style={{ fontSize: 9.5, color: uploadErr ? "#b91c1c" : "var(--td)", marginTop: 3 }}>
                  {uploading ? "Mengunggah foto…" : uploadErr || "JPG/PNG. Foto tersimpan per tanggal, jadi perkembangannya bisa dibandingkan."}
                </div>
              </div>
            </div>
          </div>

          <div className="fg">
            <label className="flab">Kondisi umum pasien *</label>
            <textarea className="fi" name="condition_note" required rows={2} placeholder="mis. Lemas berkurang, respons membaik, masih batuk sesekali" style={{ resize: "vertical" }} />
          </div>
          {!petHotel && <div className="fg">
            <label className="flab">Tindakan / perawatan</label>
            <textarea className="fi" name="tindakan" rows={2} placeholder="mis. Wound dressing, terapi cairan, injeksi antibiotik, observasi" style={{ resize: "vertical" }} />
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Obat / BMHP yang ditagihkan dicatat di OBAT KHUSUS — kolom ini untuk tindakan medisnya.
            </div>
          </div>}
          <div className="fg">
            <label className="flab">{petHotel ? "Catatan" : "Keterangan"}</label>
            <textarea className="fi" name="keterangan" rows={2} placeholder="mis. Nafsu makan mulai kembali, rencana cek darah ulang besok" style={{ resize: "vertical" }} />
          </div>

          {/* Komunikasi ke pemilik: shift berikutnya harus tahu owner sudah dikabari
              apa, tanpa perlu bertanya ke orang yang sudah pulang. */}
          <div className="frow">
            <div style={{ flex: 2 }}>
              <label className="flab">Yang disampaikan ke pemilik hari ini</label>
              <textarea className="fi" name="komunikasi_owner" rows={2}
                placeholder="mis. Owner dikabari hasil rontgen & rencana operasi besok, owner setuju" style={{ resize: "vertical" }} />
            </div>
            <div>
              <label className="flab">Lewat</label>
              <select className="fi" name="komunikasi_via" defaultValue="">
                <option value="">— belum dihubungi —</option>
                {OPSI_KOMUNIKASI.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="frow">
            <div>
              {petHotel ? <>
                <input type="hidden" name="log_kind" value="monitoring" />
                <label className="flab">Paramedis yang mencatat *<select className="fi" name="paramedic_id" aria-label="Paramedis yang mencatat" required value={staff.paramedic_id ?? ""} onChange={event => setStaff({ log_kind: "monitoring", visit_doctor_id: null, paramedic_id: event.target.value || null })}>
                  <option value="">— pilih paramedis —</option>{paramedics.map(row => <option key={row.id} value={row.id}>{row.nama}</option>)}
                </select></label>
              </> : <InpatientStaffFields value={staff} onChange={setStaff} doctors={doctors} paramedics={paramedics}/>}
            </div>
            <div>
              <label className="flab">Ubah kondisi</label>
              <select className="fi" name="new_status" defaultValue="">
                <option value="">— tetap ({patient.kondisi})</option>
                <option value="stabil">Stabil</option>
                <option value="kritis">Kritis</option>
                <option value="sembuh">Sembuh / Boleh Pulang</option>
                <option value="rip">RIP (Meninggal)</option>
                <option value="pulang_paksa">Pulang Paksa (perlu form khusus bertanda tangan)</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Link href={backHref} className="btn-def">Batal</Link>
            <SubmitButton className="pay-btn" icon="ti-device-floppy" pendingText="Menyimpan…" busy={draftLeaving} style={{ width: "auto", flex: 1 }}>Simpan Catatan Rawat Inap</SubmitButton>
          </div>
          </>}
        </div>

        {/* ===== KANAN: shared cart, standalone OBAT KHUSUS or clinical visit Jasa ===== */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em", marginBottom: 12 }}>
            <i className="ti ti-shopping-cart" style={{ color: "var(--posb)" }} /> {billables ? "OBAT KHUSUS · OBAT / BMHP & RACIKAN" : mode === "clinical" ? "JASA VISIT" : "INPUT OBAT & JASA (POS)"}
            {mode === "clinical" && <Link href={`${backHref}/obat-khusus`} className="btn-def">Obat / BMHP → OBAT KHUSUS</Link>}
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {TABS.filter(t => mode !== "clinical" || t.id === "Jasa").map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)} className="back-btn" style={{
                flex: 1, justifyContent: "center", padding: "8px 0", borderRadius: 8, fontSize: 11.5, fontWeight: 600,
                border: ".5px solid var(--bd)", background: tab === t.id ? "var(--posb)" : "#fff", color: tab === t.id ? "#fff" : "var(--tm)",
              }}><i className={`ti ${t.icon}`} /> {t.id}</button>
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
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--tm)", marginBottom: 5 }}>DAFTAR OBAT</div>
                  <div style={{ maxHeight: 320, overflowY: "auto", overflowX: "auto" }}>
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
              {tab === "Jasa" && (
                <ClinicServicePicker key={tab} kind="Jasa" items={jasaItems} onAdd={addObat} />
              )}
              {tab === TINDAKAN && (
                <TindakanRacikanForm tindakanItems={tindakanItems} racikanItems={racikanItems} bmhpItems={items} bahanItems={bahanItems}
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
                {cart.length > 0 && <button type="button" onClick={clear} className="back-btn" style={{ fontSize: 10, color: "#b91c1c" }}>Hapus semua</button>}
              </div>
              <div style={{ minHeight: 60, overflowX: "auto" }}>
                {cart.length === 0 ? (
                  <div style={{ fontSize: 10.5, color: "var(--td)", padding: "8px 0" }}>Belum ada item. Tambah obat/jasa/racikan dari kiri.</div>
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
                            <ServicePerformersField compact label={`Pelaksana ${r.nama_obat}`} value={r.service_performers} staff={serviceStaff}
                              grooming={groomingApplies && r.jenis === "jasa" && (r.kategori === "Grooming" || [...jasaItems, ...tindakanItems].some(item => item.id === r.item_id && item.tindakan_kategori === "Grooming"))}
                              doctorRequired={groomingDoctorRequired}
                              onChange={value => setCart(rows => rows.map(row => row.key === r.key ? {...row, service_performers:value} : row))} />
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
                            <i className="ti ti-x" onClick={() => del(r.key)} style={{ cursor: "pointer", color: "#dc2626", fontSize: 13 }} title="Hapus" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={{ marginTop: 10 }}>
                <label className="flab">Catatan resep / keterangan</label>
                <textarea className="fi" rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Aturan pakai obat…" style={{ resize: "vertical" }} />
              </div>

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
                <div style={{ fontSize: 9, color: "var(--td)", marginTop: 6 }}>Masuk resep kunjungan yang sama → ditagihkan melalui Bayar tagihan. Belum menerima uang atau menerbitkan faktur.</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 6, marginTop: 12 }}>
                <SubmitButton className="btn-def" icon="ti-printer" name="cetak" value="1" pendingText="…" busy={draftLeaving} style={{ padding: "9px 0", fontSize: 11.5 }}>Simpan &amp; Cetak</SubmitButton>
                <SubmitButton className="btn-acc" icon="ti-circle-check" name="cetak" value="0" pendingText="Menyimpan…" busy={draftLeaving} style={{ justifyContent: "center", padding: "9px 0", fontSize: 12, background: "#16a34a" }}>{billables ? "Simpan obat / BMHP" : "Simpan Catatan & Lanjut"}</SubmitButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  </>);
}

function MiniKV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 5 }}>
      <span style={{ color: "var(--tm)", minWidth: 74 }}>{k}</span>
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
