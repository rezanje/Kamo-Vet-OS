"use client";

import { QtyInput } from "@/components/QtyInput";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ServicePerformersField } from "@/components/ServicePerformersField";
import { TindakanRacikanForm } from "@/components/TindakanRacikanForm";
import { VaksinasiDariVial } from "@/components/VaksinasiDariVial";
import { KeranjangBahan } from "@/components/KeranjangBahan";
import { ClinicServicePicker } from "@/components/ClinicServicePicker";
import { vaccinationBmhp, vaccinationOf, type BmhpRow } from "@/lib/procedure-bmhp";
import { bulkFillServicePerformers, emptyServicePerformers, visitDefaultPerformers, type ServicePerformersInput, type ServiceStaff } from "@/lib/service-performers";
import { useClinicDraft } from "@/components/useClinicDraft";
import { SubmitButton } from "@/components/SubmitButton";
import { kekuranganStok } from "@/lib/stok-keranjang";
import { StokKurangPopup, StokKurangDariPesan } from "@/components/StokKurangPopup";
import type { BarisKurangStok } from "@/lib/stok-kurang";
import { type RacikanIngredient } from "@/lib/racikan";
import { pickUnit, type ItemUnit } from "@/lib/satuan";
import { type KatalogRacikan } from "@/lib/katalog-racikan";
import { masterCompoundCartRow, type CompoundDraft } from "@/lib/master-compound-cart";
import { tambahItemRekamMedis } from "../actions";

type UnitLite = Omit<ItemUnit, "buy_price">;
export type ItemLite = {
  id: string; code?: string | null; upc?: string | null; name: string; unit: string; sell_price: number; stok: number;
  item_type?: string; tindakan_kategori?: string | null; units?: UnitLite[];
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
  bmhp?: BmhpRow[];
  compound_recipe_id?: string;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
/** Tab persis form pemeriksaan: tindakan dan racikan dikerjakan dari satu tab. */
const TINDAKAN = "Tindakan & Racikan";
const TABS = [["Obat", "ti-pill"], ["Jasa", "ti-stethoscope"], [TINDAKAN, "ti-package"]] as const;
type Tab = (typeof TABS)[number][0];

/**
 * Tambah obat / jasa / tindakan / racikan ke rekam medis yang SUDAH tersimpan tapi
 * belum ditagih (keputusan Andri 29 Okt, opsi B). Keranjang, aturan BMHP, pemeriksaan
 * stok, dan pemilih pelaksana memakai komponen yang sama dengan form pemeriksaan;
 * yang berbeda cuma muatan yang dikirim — hanya daftar item, tanpa catatan klinis.
 */
export function TambahItemForm({
  visitId, requestKey, draftUserId, items, racikanItems, bahanItems, jasaItems, tindakanItems,
  katalogRacikan, bolehManual, serviceStaff = [], visitDoctorId = null,
  groomingDoctorRequired = false, groomingApplies = true, tabAwal,
}: {
  visitId: string; requestKey: string; draftUserId: string;
  items: ItemLite[]; racikanItems: ItemLite[]; bahanItems: ItemLite[]; jasaItems: ItemLite[]; tindakanItems: ItemLite[];
  katalogRacikan: KatalogRacikan[]; bolehManual: boolean;
  serviceStaff?: ServiceStaff[];
  visitDoctorId?: string | null;
  groomingDoctorRequired?: boolean;
  groomingApplies?: boolean;
  tabAwal?: string;
}) {
  const back = `/klinik/rekam-medis/${visitId}`;
  const [tab, setTab] = useState<Tab>(tabAwal === "obat" ? "Obat" : TINDAKAN);
  const [search, setSearch] = useState("");
  const [obatPage, setObatPage] = useState(1);
  const [cart, setCart] = useState<CartRow[]>([]);
  const [procedureDraft, setProcedureDraft] = useState<{ item: ItemLite; bmhp: BmhpRow[]; editKey: string | null } | null>(null);
  const [procedureError, setProcedureError] = useState("");
  const procedureCommitted = useRef(false);
  const [bulkPerformers, setBulkPerformers] = useState(emptyServicePerformers);
  const [stokKurang, setStokKurang] = useState<BarisKurangStok[]>([]);

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
    userId: draftUserId, scope: `susulan:${visitId}`, requestKey,
    optionalSnapshotKeys: ["saleItemId", "procedureDraft", "racikanEditKey"],
    snapshot: { saleItemId, cart, procedureDraft, racikanEditKey, racikNama, officialVersionId, racikForm, racikAturan, racikBahan },
    restore: (value) => {
      setCart(value.cart);
      setProcedureDraft(value.procedureDraft ?? null);
      setRacikanEditKey(value.racikanEditKey ?? null);
      setRacikNama(value.racikNama);
      setSaleItemId(value.saleItemId ?? "");
      setOfficialVersionId(value.officialVersionId);
      setRacikForm(value.racikForm);
      setRacikAturan(value.racikAturan);
      setRacikBahan(value.racikBahan);
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
  const addRacikanToCart = () => {
    const sku = racikanItems.find(item => item.id === saleItemId) ?? null;
    let dibuat;
    try { dibuat = masterCompoundCartRow(sku, selectedFormula ?? null, compoundDraft, racikanEditKey ?? crypto.randomUUID(), bolehManual); }
    catch (error) { setProcedureError(error instanceof Error ? error.message : "Racikan belum lengkap"); return; }
    const baris = dibuat;
    setCart(rows => racikanEditKey
      ? rows.map(line => line.key === racikanEditKey ? { ...baris, service_performers: line.service_performers } : line)
      : [...rows, { ...baris, service_performers: visitDefaultPerformers(visitDoctorId) }]);
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

  const addObat = (it: ItemLite, bmhp?: BmhpRow[]) => setCart((c) => {
    const isService = it.item_type === "Jasa";
    const ex = isService || bmhp ? undefined : c.find((r) => r.item_id === it.id && r.jenis !== "jasa");
    if (ex) return c.map((r) => (r.item_id === it.id ? { ...r, qty: r.qty + 1 } : r));
    const u = isService ? undefined : (it.units ?? [])[0];
    return [...c, {
      key: isService || bmhp ? crypto.randomUUID() : it.id, item_id: it.id, nama_obat: it.name, qty: 1,
      satuan: u?.unit ?? it.unit, harga: u?.sell_price ?? it.sell_price, faktor: u?.factor ?? 1,
      jenis: isService ? "jasa" : "obat",
      kategori: isService ? it.tindakan_kategori ?? undefined : undefined,
      service_performers: visitDefaultPerformers(visitDoctorId),
      ...(bmhp ? { bmhp } : {}),
    }];
  });
  const selectProcedure = (item: ItemLite): void => {
    const vaccination = item.item_type !== "Jasa" ? vaccinationOf(item, tindakanItems) : undefined;
    const picked = vaccination ?? item;
    setTab(TINDAKAN);
    if (procedureDraft?.item.id === picked.id && !procedureDraft.editKey) return;
    procedureCommitted.current = false;
    setProcedureError("");
    resetRacikan();
    setProcedureDraft({ item: picked, bmhp: vaccinationBmhp(picked, [...items, ...tindakanItems]), editKey: null });
  };
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
  const setQty = (key: string, qty: number) => setCart((c) => c.map((r) => (r.key === key ? { ...r, qty: Math.max(1, qty) } : r)));
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
  const formItem = procedureDraft?.item ?? racikanItems.find(item => item.id === saleItemId) ?? null;
  const formEditKey = procedureDraft ? procedureDraft.editKey : racikanEditKey;
  const formHarga = (formEditKey ? cart.find(row => row.key === formEditKey)?.harga : undefined) ?? formItem?.sell_price ?? 0;
  const commitForm = () => (procedureDraft ? commitProcedure() : addRacikanToCart());
  const cancelForm = () => { setProcedureDraft(null); resetRacikan(); setProcedureError(""); };

  const subtotal = cart.reduce((a, r) => a + r.qty * r.harga, 0);
  const stokById = useMemo(() => new Map([...items, ...bahanItems, ...racikanItems]
    .filter(it => it.item_type !== "Jasa").map(it => [it.id, { stok: it.stok, unit: it.unit }])), [items, bahanItems, racikanItems]);

  return (<>
    <StokKurangPopup baris={stokKurang} onClose={() => setStokKurang([])}
      petunjuk="Kurangi jumlahnya atau ganti dengan obat lain yang stoknya ada." />
    {stokKurang.length === 0 && <StokKurangDariPesan pesan={draftSaveError}
      petunjuk="Kurangi jumlahnya atau ganti dengan obat lain yang stoknya ada." />}
    <form ref={draftAttachForm} action={(data) => draftSubmit(data, tambahItemRekamMedis)}
      onInputCapture={draftCapture} onChangeCapture={draftCapture} onSubmitCapture={event => {
        const kurang = kekuranganStok(cart, stokById, (id, unit) => unitsOf(id).find(u => u.unit === unit)?.factor ?? 1);
        if (procedureDraft || saleItemId) {
          event.preventDefault(); event.stopPropagation(); setTab(TINDAKAN);
          setProcedureError("Selesaikan form tindakan / racikan: tambahkan ke keranjang atau batalkan sebelum menyimpan.");
        } else if (!cart.length) {
          event.preventDefault(); event.stopPropagation();
          setProcedureError("Pilih minimal satu obat, jasa, tindakan, atau racikan.");
        } else if (kurang.length) { event.preventDefault(); event.stopPropagation(); setStokKurang(kurang); }
        else draftCapture();
      }}>
      {draftRecovered && <div role="status" className="p2ban">Draf dipulihkan <button type="button" className="btn-def" onClick={draftDiscard}>Buang draf</button></div>}
      {procedureError && <div role="alert" className="p2ban">{procedureError}</div>}
      {(draftStorageError || draftSaveError) && <div role="alert" className="p2ban">{draftSaveError || draftStorageError}</div>}
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="request_key" value={draftSubmissionKey} />
      <input type="hidden" name="resep" value={JSON.stringify(cart)} />

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em", marginBottom: 12 }}>
          <i className="ti ti-shopping-cart" style={{ color: "var(--posb)" }} /> TAMBAH OBAT, JASA &amp; TINDAKAN
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {TABS.map(([t, ic]) => (
            <button key={t} type="button" onClick={() => setTab(t)} className="back-btn" style={{
              flex: 1, justifyContent: "center", gap: 6, padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 600,
              border: ".5px solid var(--bd)", background: tab === t ? "var(--posb)" : "#fff", color: tab === t ? "#fff" : "var(--tm)",
            }}><i className={`ti ${ic}`} /> {t}</button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
          <div>
            {tab === "Obat" && (
              <>
                <div style={{ position: "relative", marginBottom: 8 }}>
                  <input className="fi" placeholder="Cari nama obat / scan barcode…" value={search}
                    onChange={(e) => { setSearch(e.target.value); setObatPage(1); }} style={{ paddingRight: 28 }} />
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
            {tab === "Jasa" && <ClinicServicePicker key={tab} kind="Jasa" items={jasaItems} onAdd={addObat} />}
            {tab === TINDAKAN && (
              <TindakanRacikanForm tindakanItems={tindakanItems} racikanItems={racikanItems} bmhpItems={items} bahanItems={bahanItems}
                katalogRacikan={katalogRacikan} bolehManual={bolehManual}
                tindakan={procedureDraft} racikan={compoundDraft} editing={!!formEditKey} harga={formHarga}
                onPilihTindakan={selectProcedure} onPilihRacikan={selectRacikan}
                onUbahBmhp={bmhp => setProcedureDraft(draft => draft ? { ...draft, bmhp } : draft)}
                onUbahRacikan={changeCompound} onSimpan={commitForm} onBatal={cancelForm} />
            )}
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)" }}>ITEM SUSULAN ({cart.length})</span>
              {cart.length > 0 && <button type="button" onClick={clear} className="back-btn" style={{ fontSize: 10, color: "#b91c1c" }}>Hapus semua</button>}
            </div>
            <div style={{ minHeight: 60, overflowX: "auto" }}>
              {cart.length === 0 ? (
                <div style={{ fontSize: 10.5, color: "var(--td)", padding: "8px 0" }}>Belum ada item. Tambah obat/jasa/tindakan dari kiri.</div>
              ) : (
                <table className="tbl" style={{ minWidth: 300 }}>
                  <thead>
                    <tr><th>Nama</th><th style={{ textAlign: "center", width: 48 }}>Qty</th><th style={{ textAlign: "right" }}>Subtotal</th><th style={{ width: 26 }} /></tr>
                  </thead>
                  <tbody>
                    {cart.map((r) => (
                      <tr key={r.key}>
                        <td style={{ fontSize: 10.5 }}>
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
                            onChange={value => setCart(rows => rows.map(row => row.key === r.key ? { ...row, service_performers: value } : row))} />
                          {r.jenis !== "racikan" && r.item_id && tindakanItems.some(item => item.id === r.item_id) &&
                            <KeranjangBahan nada="bmhp" judul="BMHP" kosong="belum diisi"
                              baris={(r.bmhp ?? []).map(material => `${material.nama} × ${material.qty} ${material.unit}`)}>
                              <button type="button" className="btn-def" aria-label={`Ubah BMHP ${r.nama_obat}`}
                                style={{ marginTop: 3, padding: "1px 7px", fontSize: 9.5 }} onClick={() => editProcedure(r)}>Ubah BMHP</button>
                            </KeranjangBahan>}
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

            {cart.length > 0 && <div>
              <ServicePerformersField label="Isi pelaksana sekaligus" value={bulkPerformers} staff={serviceStaff} onChange={setBulkPerformers} />
              <button type="button" className="btn-def" onClick={() => setCart(rows => bulkFillServicePerformers(rows, bulkPerformers))}>Isi baris kosong</button>
              <p style={{ fontSize: 10 }}>Baris yang sudah memiliki pelaksana tetap mengikuti pilihannya.</p>
            </div>}

            <div style={{ marginTop: 10, borderTop: ".5px solid var(--bd)", paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>Tambahan tagihan</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: "var(--posb)" }}>{rp(subtotal)}</span>
            </div>
            <div style={{ fontSize: 9, color: "var(--td)", marginTop: 6 }}>
              Item ini masuk rekam medis sekarang dan otomatis muncul di layar Pembayaran. Harga &amp; diskon final tetap dikonfirmasi kasir.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <Link href={back} className="btn-def">Batal</Link>
          <SubmitButton className="btn-acc" icon="ti-device-floppy" style={{ padding: "10px 20px", fontSize: 13 }}
            pendingText="Menyimpan…" busy={draftLeaving}>Simpan ke rekam medis</SubmitButton>
        </div>
      </div>
    </form>
  </>);
}
