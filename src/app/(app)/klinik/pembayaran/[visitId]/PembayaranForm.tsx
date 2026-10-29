"use client";

import { NumberInput } from "@/components/NumberInput";
import { QtyInput } from "@/components/QtyInput";
import { aggregateServiceLines } from "@/lib/service-line-promos";

import { ServicePerformersField } from "@/components/ServicePerformersField";
import { bulkFillServicePerformers, emptyServicePerformers, servicePerformerNames, visitDefaultPerformers, type ServicePerformersSnapshot, type ServiceStaff } from "@/lib/service-performers";
import styles from "./PembayaranForm.module.css";

import { METODE_BAYAR as SPLIT_METHODS } from "@/lib/kas-akun";
import { kurangUangMuka, pesanDpMinimal } from "@/lib/dp-minimal";
import { validateSplitPaymentTotal, type SplitPaymentDraft } from "@/lib/clinic-split-payment";

import { quoteDemoPayments, type DemoFinancialPolicy } from "@/lib/clinic-demo-policy";
import type { PilihanPenjual } from "@/lib/penjual";
import type { ItemUnit } from "@/lib/satuan";
import { useClinicDraft } from "@/components/useClinicDraft";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SearchableItemPicker } from "@/components/SearchableItemPicker";
import { SubmitButton } from "@/components/SubmitButton";
import { Popup } from "@/components/Popup";
import { StokKurangDariPesan } from "@/components/StokKurangPopup";
import { bayarVisit } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";
import { METODE_BAYAR } from "@/lib/metode-bayar";
import { hitungPromoKeranjang } from "@/lib/promo-hitung";
import { diskonGolonganKeranjang } from "@/lib/harga-golongan";
import { pesanVoucherDitolak, potonganVoucher } from "@/lib/voucher";
import { bacaKode, pesanKampanyeDitolak, promoDenganKode } from "@/lib/kode-kampanye";
import { hargaNetto, nilaiBaris, type BekalPotongan } from "@/lib/tagihan-klinik";

type Line = {
  key?: string;
  salesperson_id?: string | null;
  salesperson_name?: string | null;
  source_invoice_item_id?: string | null;
  service_performers?: ServicePerformersSnapshot | null;
  kategori?: string | null;
  deskripsi: string; qty: number; harga: number; item_id?: string | null; satuan?: string | null;
  prescription_item_id?: string | null; recipe_id?: string | null;
  /** Diskon baris dalam persen — permintaan Pak Aldi, meeting 14 Agustus. */
  diskon_persen?: number;
  /**
   * Baris yang jumlahnya dihitung sistem dan tidak boleh diketik ulang — sejauh
   * ini cuma lama rawat inap (keputusan Aldi, 19 Agustus: "ini minta dikunci").
   * Koreksi harganya lewat kolom diskon, yang tetap terbuka.
   */
  terkunci?: boolean;
  /** H05: package (Grup) this component line was sold in, and how many packages. */
  package_item_id?: string | null;
  package_qty?: number | null;
};
export type PackageOption = { id: string; name: string; componentIds: string[]; perPaket?: Record<string, number> };
const NO_PACKAGES: PackageOption[] = [];
export type MasterItem = { id: string; code: string; name: string; unit: string; harga: number; units?: ItemUnit[]; tindakan_kategori?: string | null };
type Patient = {
  photo: string | null; name: string; species: string; owner: string; phone: string; address: string;
  dokter: string; jenisLayanan: string; noInvoice: string; tanggal: string;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
export function pesanKurangBayar(bayar: number, sisa: number): string | null {
  if (bayar >= sisa) return null;
  return `Uang diterima ${rp(bayar)}, sisa tagihan ${rp(sisa)}. Kurang ${rp(sisa - bayar)}. Lengkapi jumlah bayar, atau pilih Simpan untuk mencatat sebagai DP.`;
}

const labelMaster = (it: MasterItem) => `${it.code} — ${it.name}`;
const NO_OPEN_SOURCES: ReadonlySet<string> = new Set();
/** A recorded source with an explicit empty snapshot (no doctor/staff) was left for the cashier.
 * Recorded performers and pre-feature NULL snapshots stay sealed exactly as before. */
export function openServiceSourceIds(rows: Line[]): Set<string> {
  return new Set(rows.filter(row => row.prescription_item_id && !row.terkunci && row.service_performers != null
    && !row.service_performers.doctor_id && !row.service_performers.staff_id).map(row => row.prescription_item_id!));
}

export function ItemTable({ title, icon, color, rows, setRows, master, listId, allowUnits = false, serviceStaff = [], serviceRows = false, sealedPerformers = false, defaultDoctorId = null, groomingDoctorRequired = false, groomingApplies = true, openSourceIds = NO_OPEN_SOURCES, packages = NO_PACKAGES }: {
  title: string; icon: string; color: string; rows: Line[]; setRows: (r: Line[]) => void;
  master: MasterItem[]; listId: string; allowUnits?: boolean;
  serviceStaff?: ServiceStaff[]; serviceRows?: boolean; sealedPerformers?: boolean; groomingDoctorRequired?: boolean;
  /** Dokter PJ kunjungan — isian awal kolom Dokter pada baris baru. */
  defaultDoctorId?: string | null;
  groomingApplies?: boolean;
  /** S01: source rows saved with an explicit empty performer snapshot stay assignable by the cashier. */
  openSourceIds?: ReadonlySet<string>;
  /** H05: packages offered for tagging a component line (new invoices only). */
  packages?: PackageOption[];
}) {
  const performerLocked = (r: Line) => !!r.terkunci || (!!r.prescription_item_id && !openSourceIds.has(r.prescription_item_id));
  const set = (i: number, patch: Partial<Line>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows([...rows, { key: crypto.randomUUID(), deskripsi: "", qty: 1, harga: 0, item_id: null, diskon_persen: 0, service_performers: visitDefaultPerformers(defaultDoctorId) }]);
  const del = (i: number) => setRows(rows.filter((_, j) => j !== i));
  // Andri 29 Okt: baris resep/racikan yang dihapus tidak pernah tertagih lagi (1 kunjungan
  // = 1 tagihan). Minta konfirmasi dulu; baris yang ditambah kasir sendiri langsung hapus.
  const subtotal = rows.reduce((a, r) => a + nilaiBaris(r), 0);

  // Cocokkan ketikan ke master SKU. Kalau kena, item_id + harga jual ikut terisi
  // supaya baris ini memotong stok saat disimpan; kalau tidak kena, item_id
  // dikosongkan lagi — baris lama yang namanya diedit tidak boleh menyeret
  // item_id barang yang berbeda.
  const byLabel = new Map(master.map((it) => [labelMaster(it), it]));
  const byName = new Map<string,MasterItem|null>();
  for(const item of master){const key=item.name.trim().toLowerCase();byName.set(key,byName.has(key)?null:item);}
  const chooseMaster = (i:number,id:string) => {
    const item=master.find(row=>row.id===id);
    if(item){
      const changed=rows[i]?.item_id!==item.id || !!rows[i]?.recipe_id;
      set(i,{deskripsi:item.name,item_id:item.id,harga:item.harga,satuan:item.unit,kategori:item.tindakan_kategori,
        ...(changed ? {prescription_item_id:null,recipe_id:null,source_invoice_item_id:null,salesperson_id:null,salesperson_name:null,package_item_id:null,package_qty:null} : {})});
    }
  };
  const setNama = (i: number, v: string) => {
    const it = byLabel.get(v) ?? byName.get(v.trim().toLowerCase());
    const changed=it ? rows[i]?.item_id!==it.id || !!rows[i]?.recipe_id : v!==rows[i]?.deskripsi;
    const clearSource=changed ? {prescription_item_id:null,recipe_id:null,source_invoice_item_id:null,salesperson_id:null,salesperson_name:null,package_item_id:null,package_qty:null} : {};
    set(i, it
      ? { deskripsi: it.name, item_id: it.id, harga: it.harga, satuan: it.unit, kategori:it.tindakan_kategori, ...clearSource }
      : {
          deskripsi: v, item_id: null, kategori:null, ...clearSource,
          satuan: rows[i]?.satuan === "racikan" || rows[i]?.recipe_id ? "racikan" : null,
        });
  };

  return (
    <div style={{ border: ".5px solid var(--bd)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color }}>
          <i className={`ti ${icon}`} /> {title}
        </div>
        <button type="button" onClick={add} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }}><i className="ti ti-plus" /> Tambah</button>
      </div>
      {/* Tabel ikut menyempit di layar kecil sampai kolom Nama tidak terbaca —
          diberi lebar minimum lalu digeser mendatar, sama seperti tabel lain. */}
      <div style={{ overflowX: "auto" }}>
      <table className="tbl" style={{ minWidth: 520 }}>
        <thead><tr><th style={{ width: 26 }}>No.</th><th style={{ minWidth: 180 }}>Nama</th><th style={{ width: 54, textAlign: "center" }}>Qty</th>{allowUnits && <th style={{ width: 100 }}>Satuan</th>}<th style={{ width: 110, textAlign: "right" }}>Harga Satuan</th><th style={{ width: 66, textAlign: "center" }}>Disk %</th><th style={{ width: 100, textAlign: "right" }}>Subtotal</th><th style={{ width: 24 }} /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key ?? r.source_invoice_item_id ?? r.prescription_item_id ?? i}>
              <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{flex:1,minWidth:0}}><SearchableItemPicker items={master} value={r.item_id??""} textValue={r.deskripsi} onTextChange={text=>setNama(i,text)} onChange={id=>chooseMaster(i,id)} readOnly={!!r.recipe_id} inputId={`${listId}-${i}-name`} ariaLabel={`Nama ${title.toLowerCase()} baris ${i+1}`} placeholder="Ketik / pilih dari master"/></div>
                  {r.deskripsi.trim() && !r.item_id && !r.recipe_id && (
                    <i className="ti ti-alert-triangle" title="Bukan dari master — stok tidak akan berkurang" style={{ color: "#d97706", fontSize: 13, flexShrink: 0 }} />
                  )}
                </div>
                {sealedPerformers || performerLocked(r)
                  ? <div style={{fontSize:10,color:"var(--tm)"}}>{servicePerformerNames(r.service_performers).join(" · ")}</div>
                  : <ServicePerformersField label={`Pelaksana ${r.deskripsi || `baris ${i+1}`}`} value={r.service_performers} staff={serviceStaff}
                    grooming={groomingApplies && serviceRows && (r.kategori === "Grooming" || master.some(item => item.id === r.item_id && item.tindakan_kategori === "Grooming"))}
                    doctorRequired={groomingDoctorRequired} onChange={value => set(i,{service_performers:value})} />}
                {/* Penjual SKU lama hanya ditampilkan untuk dokumen sebelum atribusi per baris; tidak ada lagi isiannya. */}
                {!!r.salesperson_name && <div style={{fontSize:10,color:'var(--tm)'}}>Penjual (data lama): {r.salesperson_name}</div>}
                {(() => {
                  const choices = r.item_id && !r.recipe_id && !r.terkunci ? packages.filter(option => option.componentIds.includes(r.item_id!)) : [];
                  if (choices.length === 0) return null;
                  // Line qty follows the recipe: packages x component qty per package (in the line's unit).
                  const qtyUntuk = (packageId: string, jumlah: number) => {
                    const base = choices.find(option => option.id === packageId)?.perPaket?.[r.item_id!];
                    if (!base) return {};
                    const units = master.find(it => it.id === r.item_id)?.units ?? [];
                    const factor = units.find(unit => unit.unit === r.satuan)?.factor ?? 1;
                    const needed = jumlah * base; // base units, exactly as the database checks
                    const inUnit = needed / factor;
                    // Invoice lines hold whole quantities: when the chosen unit cannot express the
                    // recipe exactly, bill the component in its base unit instead of rounding.
                    if (Math.abs(inUnit - Math.round(inUnit)) < 1e-9 || factor === 1) return { qty: inUnit };
                    const baseUnit = units.find(unit => unit.factor === 1);
                    return baseUnit ? { qty: needed, satuan: baseUnit.unit, harga: baseUnit.sell_price } : { qty: inUnit };
                  };
                  return <div style={{display:'flex',gap:4,alignItems:'flex-end',marginTop:4}}>
                    <label style={{display:'block',fontSize:10,flex:1}}>Asal paket
                      <select className="fi" aria-label={`Asal paket ${r.deskripsi}`} value={r.package_item_id ?? ''}
                        onChange={event => set(i,{package_item_id:event.target.value || null,package_qty:event.target.value ? (r.package_qty ?? 1) : null,
                          ...(event.target.value ? qtyUntuk(event.target.value, r.package_qty ?? 1) : {})})} style={{height:25,fontSize:10}}>
                        <option value="">Bukan paket (penjualan biasa)</option>
                        {choices.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                      </select></label>
                    {r.package_item_id && <label style={{display:'block',fontSize:10,width:70}}>Jml paket
                      <QtyInput className="fi" min={1} step="1" aria-label={`Jumlah paket ${r.deskripsi}`} value={r.package_qty ?? 1}
                        onValue={jumlah => { set(i,{package_qty:jumlah,...qtyUntuk(r.package_item_id!, jumlah)}); }} style={{height:25,fontSize:10}} /></label>}
                  </div>;
                })()}
              </td>
              <td>
                <QtyInput className="fi" min={1} aria-label={`Jumlah ${r.deskripsi}`} value={r.qty}
                  onValue={(qty) => set(i, { qty })}
                  readOnly={r.terkunci || !!r.recipe_id} disabled={r.terkunci}
                  title={r.terkunci ? "Dihitung otomatis dari lama rawat inap" : r.recipe_id ? "Satu hasil racikan tersimpan" : undefined}
                  style={{ textAlign: "center", ...(r.terkunci ? { background: "#f3f4f6", cursor: "not-allowed" } : {}) }} />
              </td>
              {allowUnits && <td>
                {r.prescription_item_id || r.recipe_id || r.satuan === "racikan" || r.terkunci ? (
                  <span title="Satuan resep dan baris otomatis mengikuti catatan klinik">{r.satuan ?? "—"}</span>
                ) : (
                  <select className="fi" aria-label={`Satuan ${r.deskripsi || `baris ${i + 1}`}`}
                    disabled={!r.item_id} value={r.satuan ?? master.find(it => it.id === r.item_id)?.unit ?? ""}
                    onChange={e => {
                      const chosen = master.find(it => it.id === r.item_id)?.units?.find(unit => unit.unit === e.target.value);
                      if (chosen) set(i, { satuan: chosen.unit, harga: chosen.sell_price });
                    }}>
                    {!r.item_id && <option value="">Pilih barang dulu</option>}
                    {r.satuan && !master.find(it => it.id === r.item_id)?.units?.some(unit => unit.unit === r.satuan)
                      && <option value={r.satuan}>{r.satuan}</option>}
                    {(master.find(it => it.id === r.item_id)?.units ?? []).map(unit => (
                      <option key={unit.unit} value={unit.unit}>{unit.unit}{unit.factor > 1 ? ` (isi ${unit.factor})` : ""}</option>
                    ))}
                  </select>
                )}
              </td>}
              <td><NumberInput className="fi" type="number" min={0} step="any" value={r.harga} readOnly={!!r.recipe_id} title={r.recipe_id ? "Harga racikan tersimpan; koreksi melalui diskon" : undefined} onChange={(e) => set(i, { harga: Number(e.target.value) })} style={{ textAlign: "right" }} /></td>
              <td>
                <NumberInput className="fi" type="number" min={0} max={100} step="any"
                  value={r.diskon_persen ?? 0}
                  onChange={(e) => set(i, { diskon_persen: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                  style={{ textAlign: "center" }} />
              </td>
              <td style={{ textAlign: "right", fontSize: 11, fontWeight: 500 }}>
                {rp(nilaiBaris(r))}
                {(r.diskon_persen ?? 0) > 0 && (
                  <div style={{ fontSize: 9, color: "var(--td)", textDecoration: "line-through" }}>{rp(r.qty * r.harga)}</div>
                )}
              </td>
              <td style={{ textAlign: "center" }}>
                {r.terkunci
                  ? <i className="ti ti-lock" title="Baris otomatis dari rawat inap" style={{ color: "var(--td)" }} />
                  : <HapusBaris row={r} label={`Hapus baris ${r.deskripsi || i + 1}`} onHapus={() => del(i)} />}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={allowUnits ? 8 : 7} style={{ textAlign: "center", color: "var(--td)", fontSize: 10.5, padding: "10px 0" }}>Belum ada item.</td></tr>}
        </tbody>
      </table>
      </div>
      {!sealedPerformers && rows.some(row=>!performerLocked(row)) && <ServicePerformersBulk rows={rows} setRows={setRows} staff={serviceStaff} locked={performerLocked} />}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 6, fontSize: 11.5 }}>
        <span style={{ fontWeight: 600, color: "var(--tm)" }}>Subtotal {title.split(" ")[0]}</span>
        <span style={{ fontWeight: 700 }}>{rp(subtotal)}</span>
      </div>
    </div>
  );
}

function HapusBaris({ row, label, onHapus }: { row: Line; label: string; onHapus: () => void }) {
  const [tanya, setTanya] = useState(false);
  const perluTanya = !!row.prescription_item_id || !!row.recipe_id;
  return <>
    <i className="ti ti-x" role="button" aria-label={label} onClick={() => perluTanya ? setTanya(true) : onHapus()} style={{ cursor: "pointer", color: "#dc2626" }} />
    <HapusItemDialog row={tanya ? row : null} onConfirm={() => { setTanya(false); onHapus(); }} onCancel={() => setTanya(false)} />
  </>;
}

function HapusItemDialog({ row, onConfirm, onCancel }: { row: Line | null; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (row && !ref.current?.open) ref.current?.showModal(); }, [row]);
  if (!row) return null;
  const racikan = !!row.recipe_id || row.satuan === "racikan";
  return <dialog ref={ref} role="alertdialog" aria-label="Hapus item tagihan" onCancel={(event) => { event.preventDefault(); onCancel(); }}
    style={{ margin: "auto", border: ".5px solid #fca5a5", borderRadius: 12, padding: 20, maxWidth: 440, width: "calc(100% - 32px)" }}>
    <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, color: "#b91c1c", marginBottom: 8 }}>
      <i className="ti ti-alert-triangle" style={{ fontSize: 20 }} /> Hapus {row.deskripsi || "item ini"}?
    </div>
    <div style={{ fontSize: 13, color: "var(--sb)", marginBottom: 16, lineHeight: 1.5 }}>
      Item ini tidak bisa ditagih lagi di pembayaran berikutnya.{racikan ? " Bahan racikan sudah keluar dari stok saat diracik." : ""}{" "}
      Kalau uang pemilik kurang, jangan hapus item — isi jumlah yang dibayar lalu klik <b>Simpan</b> (tercatat DP/Belum Lunas, sisanya jadi piutang).
    </div>
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <button type="button" className="btn-acc" autoFocus onClick={onCancel}>Batal</button>
      <button type="button" className="btn-def" style={{ color: "#b91c1c" }} onClick={onConfirm}>Tetap hapus</button>
    </div>
  </dialog>;
}

function ServicePerformersBulk({rows,setRows,staff,locked}:{rows:Line[];setRows:(rows:Line[])=>void;staff:ServiceStaff[];locked:(row:Line)=>boolean}) {
  const [value,setValue]=useState(emptyServicePerformers);
  return <div>
    <ServicePerformersField label="Isi pelaksana sekaligus" value={value} staff={staff} onChange={setValue} />
    <button type="button" className="btn-def" onClick={()=>setRows(bulkFillServicePerformers(rows,value).map((row,index)=>locked(rows[index]) ? rows[index] : row))}>Isi baris kosong</button>
  </div>;
}

export function PembayaranForm({ visitId, requestKey, patient, initialObat, initialJasa, masterObat = [], masterJasa = [], bekal, catatanResep, ppnRate = 0, initialDiscount = 0, initialDpAmount = 0, initialCreditAmount = 0, initialDpDate = null, initialMetode = "Tunai", editMode = false, initialSalespersonId = "", serviceStaff = [], visitDoctorId = null, groomingDoctorRequired = false, groomingApplies = true, cashierName = "Akun kasir", sealedSalespersonName = "Tanpa penjual", manualUnitsEnabled = false, demoPolicy = null, demoStaff = [], draftUserId = "", sourceVersion = "", draftScope = `payment:${visitId}:new`, packages = NO_PACKAGES, racikanPending = false, minDpPercent = 0, bolehTerobosDp = false }: {
  visitId: string; requestKey: string; patient: Patient; initialObat: Line[]; initialJasa: Line[]; catatanResep: string | null;
  masterObat?: MasterItem[]; masterJasa?: MasterItem[]; bekal: BekalPotongan;
  /** Ada racikan kunjungan ini yang masih menunggu diracik. */
  racikanPending?: boolean;
  draftUserId?: string; draftScope?: string; sourceVersion?: string;
  packages?: PackageOption[];
  demoPolicy?: DemoFinancialPolicy | null; demoStaff?: PilihanPenjual[];
  manualUnitsEnabled?: boolean;
  serviceStaff?: ServiceStaff[]; cashierName?: string;
  /** Dokter PJ kunjungan — isian awal kolom Dokter pada baris yang belum punya atribusi. */
  visitDoctorId?: string | null;
  groomingDoctorRequired?: boolean;
  groomingApplies?: boolean;
  salespeople?: PilihanPenjual[]; initialSalespersonId?: string; sealedSalespersonName?: string;
  ppnRate?: number;
  initialDiscount?: number; initialDpAmount?: number; initialCreditAmount?: number; initialDpDate?: string | null; initialMetode?: string; editMode?: boolean;
  /** Uang muka minimal tagihan klinik (persen). 0 = aturannya dimatikan. */
  minDpPercent?: number;
  /** Peran kasir boleh menyimpan di bawah minimum dengan alasan (OWNER/ADMIN/FINANCE). */
  bolehTerobosDp?: boolean;
}) {
  const [draftSourceVersion, setDraftSourceVersion] = useState(sourceVersion);
  const sourceChanged = !!sourceVersion && draftSourceVersion !== sourceVersion;
  const latestSourceSubtotal = [...initialObat, ...initialJasa].reduce((sum,row)=>sum+nilaiBaris(row),0);
  const [openSourceIds] = useState(() => openServiceSourceIds([...initialObat, ...initialJasa]));
  // Baris yang masih boleh diisi kasir berangkat dari dokter PJ kunjungan.
  const berikanDefault = (rows: Line[]) => editMode ? rows : rows.map(row => row.terkunci
    || (!!row.prescription_item_id && !openSourceIds.has(row.prescription_item_id))
    || row.service_performers?.doctor_id || row.service_performers?.staff_id
    ? row : { ...row, service_performers: visitDefaultPerformers(visitDoctorId) });
  const [obat, setObat] = useState<Line[]>(() => berikanDefault(initialObat));
  const [jasa, setJasa] = useState<Line[]>(() => berikanDefault(initialJasa));
  const [discount, setDiscount] = useState(initialDiscount);
  const [metode, setMetode] = useState(initialMetode);
  const [reason, setReason] = useState("");
  const [voucher, setVoucher] = useState("");
  const [salesperson, setSalesperson] = useState(initialSalespersonId);
  const [demoEnabled, setDemoEnabled] = useState(!editMode && !!demoPolicy && demoStaff.length > 0 && /^DEMO\b/i.test(patient.owner));
  const [demoPolicyId, setDemoPolicyId] = useState(demoPolicy?.id ?? "");
  const [demoEmployees, setDemoEmployees] = useState(demoStaff.map(person => person.id));
  const [dpOverrideReason, setDpOverrideReason] = useState("");
  const [mixed, setMixed] = useState(false);
  const [splitPayments, setSplitPayments] = useState<SplitPaymentDraft[]>([{ method: "Tunai", amount: 0 }, { method: "Transfer", amount: 0 }]);

  const barisSemua = [...obat, ...jasa].filter((r) => r.deskripsi.trim() && r.qty > 0);
  // Diskon per baris dipotong lebih dulu; promo/voucher/golongan menghitung dari
  // harga yang sudah didiskon, urutannya sama dengan kasir petshop.
  const subtotal = barisSemua.reduce((a, r) => a + nilaiBaris(r), 0);

  // Potongan ditampilkan di layar dengan rumus yang sama dengan server. Server
  // tetap menghitung ulang saat menyimpan — ini supaya kasir bisa menyebut angka
  // ke pemilik SEBELUM menekan bayar, bukan supaya layar menentukan uang.
  // Only pricing groups equivalent services; saved rows retain their separate performers.
  const barisPotongan = aggregateServiceLines([
    ...obat.map(row => ({...row, item_type:"Persediaan"})),
    ...jasa.map(row => ({...row, item_type:row.item_id ? "Jasa" : "Persediaan"})),
  ].filter(row => row.deskripsi.trim() && row.qty > 0).map(row => ({
    item_id:row.item_id ?? "", qty:row.qty, harga:hargaNetto(row), satuan:row.satuan, item_type:row.item_type,
  })));
  // Kode kampanye (C05): terikat voucher → syarat voucher itu; terikat promo → promo itu ikut dipotong.
  const kodeTerbaca = bacaKode(voucher, bekal.kodeKampanye ?? []);
  const kampanye = kodeTerbaca.kampanye;
  const promoEfektif = promoDenganKode(bekal.promos, kodeTerbaca.promoId);
  const hasilPromo = editMode ? [] : hitungPromoKeranjang(promoEfektif, barisPotongan);
  const promoVal = hasilPromo.reduce((a, p) => a + p.potongan, 0);
  const golonganVal = editMode ? 0 : diskonGolonganKeranjang(
    barisPotongan, bekal.aturanDiskon, bekal.golonganPersen, new Map(Object.entries(bekal.infoBarang)),
  );
  const dasarVoucher = Math.max(0, subtotal - promoVal);
  const voucherRow = kodeTerbaca.voucherCode ? bekal.vouchers.find((v) => v.code === kodeTerbaca.voucherCode) : undefined;
  const tolakKampanye = kampanye && !editMode ? pesanKampanyeDitolak(kampanye,
    promoEfektif.some((p) => p.id === kodeTerbaca.promoId), hasilPromo.some((p) => p.promoId === kodeTerbaca.promoId)) : null;
  const tolakVoucher = voucher.trim() === "" ? null : tolakKampanye ?? (kampanye && !kampanye.voucher_code ? null : pesanVoucherDitolak(voucherRow ?? null, bekal.hariIni, {
    dasar: dasarVoucher, adaPromoOtomatis: promoVal > 0,
    customerId: bekal.customerId, categoryId: bekal.categoryId,
  }));
  const voucherVal = !editMode && voucherRow && !tolakVoucher ? potonganVoucher(dasarVoucher, voucherRow) : 0;
  const potonganOtomatis = Math.min(subtotal, promoVal + golonganVal + voucherVal);

  const dppSebelumPoin = Math.max(0, subtotal - discount - potonganOtomatis);

  // Poin: mesin & batasnya sama dengan kasir petshop (1 poin = Rp1), dan hanya
  // dipotong saat tagihan dilunasi — server menegakkan ulang batas ini.
  const [poinPakai, setPoinPakai] = useState(0);
  const poinMaks = Math.min(bekal.poinSaldo, dppSebelumPoin);
  const poinDipakai = Math.min(Math.max(0, Math.floor(poinPakai)), poinMaks);

  const dpp = Math.max(0, dppSebelumPoin - poinDipakai);
  // Tarif PPN datang dari pengaturan Mode PKP, BUKAN dipatok 11% di sini.
  // Dulu angkanya hardcoded sementara server sudah benar → layar menagih
  // Rp11.330 lebih besar dari yang tersimpan di invoice.
  const tax = Math.round((dpp * ppnRate) / 100);
  const baseTotal = dpp + tax;
  let demoError: string | null = null;
  let customerFee = 0; let companyFee = 0;
  if (demoEnabled && demoPolicy) {
    if (demoPolicyId !== demoPolicy.id) demoError = "Versi aturan draf sudah berubah. Periksa aturan lalu aktifkan ulang sebelum checkout baru.";
    else {
      try {
        const quote = quoteDemoPayments(demoPolicy, mixed ? splitPayments : [{method: metode, amount: baseTotal}]);
        customerFee = quote.customerFee; companyFee = quote.companyFee;
      } catch (error) { demoError = error instanceof Error ? error.message : "Periksa pembayaran DEMO."; }
    }
    if (!demoEmployees.length) demoError = "Pilih petugas penerima insentif.";
  }
  const total = baseTotal + customerFee;
  const dpPaid = initialDpAmount;
  const sisa = Math.max(0, total - dpPaid - initialCreditAmount);

  const [bayarKetik, setBayar] = useState(0);
  // Samakan dengan kasir petshop (Andri 29 Okt): selain Tunai, jumlah bayar otomatis
  // = sisa tagihan. Kasir tetap boleh mengubahnya (mis. DP sebagian lewat transfer).
  const [bayarManual, setBayarManual] = useState(false);
  const bayar = metode !== "Tunai" && !bayarManual ? sisa : bayarKetik;
  const [kurangBayar, setKurangBayar] = useState<string | null>(null);
  // Racikan belum siap tidak menolak pembayaran; kasir hanya diminta mengkonfirmasi sekali.
  const [konfirmasiRacikan, setKonfirmasiRacikan] = useState<FormData | null>(null);
  const racikanDikonfirmasi = useRef(false);
  const splitAmount = splitPayments.reduce((sum, part) => sum + part.amount, 0);
  const totalDiterima = dpPaid + initialCreditAmount + (mixed ? splitAmount + customerFee : bayar);
  const kembalian = mixed ? 0 : Math.max(0, bayar - sisa);
  let splitError: string | null = null;
  if (mixed) {
    try { validateSplitPaymentTotal(splitPayments, baseTotal); }
    catch (error) { splitError = error instanceof Error ? error.message : "Periksa rincian pembayaran."; }
  }
  const paidStatus = totalDiterima >= total && total > 0 ? "Lunas" : totalDiterima > 0 ? "DP" : "Belum Lunas";
  // Uang muka minimal (Andri, 29 Oktober 2026). Database yang menolak; layar hanya
  // memberi tahu lebih awal supaya kasir tidak menyebut angka yang nanti ditolak.
  const kurangDp = editMode || mixed ? 0 : kurangUangMuka(total, totalDiterima, minDpPercent);
  const statusColor = paidStatus === "Lunas" ? "#15803d" : paidStatus === "DP" ? "#7c3aed" : "#b91c1c";

  const { submissionKey, attachForm, capture, recovered, discard, storageError, saveError, submit, leaving } = useClinicDraft({
    userId: draftUserId, scope: draftScope, requestKey,
    uncertainMessage: "Hasil pembayaran belum dapat dipastikan. Isian dan kunci percobaan tetap tersimpan. Periksa invoice sebelum mencoba lagi; jangan menerima pembayaran ulang.",
    snapshot: { sourceVersion: draftSourceVersion, obat, jasa, discount, metode, reason, voucher, poinPakai, bayar, salesperson, mixed, splitPayments, demoEnabled, demoPolicyId, demoEmployees },
    optionalSnapshotKeys: ["sourceVersion", "mixed", "splitPayments", "demoEnabled", "demoPolicyId", "demoEmployees"],
    restore: value => {
      const changed = !!sourceVersion && value.sourceVersion !== sourceVersion;
      setDraftSourceVersion(typeof value.sourceVersion === "string" ? value.sourceVersion : sourceVersion ? "legacy-unknown" : "");
      const restoreRows = (saved: Line[], initial: Line[]) => {
        // Never alter an uncertain retry payload silently. Explicit source review
        // discards this browser draft and obtains a fresh request identity.
        if (changed) return saved;
        const restored = saved.map(row => {
        const locked = initial.find(source => source.terkunci && source.item_id === row.item_id);
          return locked ? { ...row, deskripsi: locked.deskripsi, item_id: locked.item_id,
            satuan: locked.satuan, prescription_item_id: locked.prescription_item_id,
            recipe_id: locked.recipe_id, qty: locked.qty, terkunci: true } : row;
        });
        return [...restored, ...initial.filter(source => source.terkunci
          && !restored.some(row => row.item_id === source.item_id))];
      };
      setObat(restoreRows(value.obat, initialObat)); setJasa(restoreRows(value.jasa, initialJasa));
      setDiscount(value.discount); setMetode(value.metode); setReason(value.reason);
      setVoucher(value.voucher); setPoinPakai(value.poinPakai); setBayar(value.bayar); setBayarManual(value.metode !== "Tunai" && Number(value.bayar) > 0); setSalesperson(value.salesperson);
      setDemoEnabled(!editMode && !!demoPolicy && value.demoEnabled === true);
      setDemoPolicyId(typeof value.demoPolicyId === "string" ? value.demoPolicyId : demoPolicy?.id ?? "");
      setDemoEmployees(Array.isArray(value.demoEmployees) ? value.demoEmployees.filter(id => demoStaff.some(person => person.id === id)) : demoStaff.map(person => person.id));
      setMixed(!editMode && value.mixed === true);
      setSplitPayments(Array.isArray(value.splitPayments) ? value.splitPayments : [{ method: "Tunai", amount: 0 }, { method: "Transfer", amount: 0 }]);
    },
  });

  const items = JSON.stringify([
    ...obat.map((r) => ({ ...r, jenis: "obat" })),
    ...jasa.map((r) => ({ ...r, jenis: "jasa" })),
  ].filter((r) => r.deskripsi.trim()));
  const today = hariIniWIB();

  return (<>
    {/* Di luar <form>: dialog punya form method="dialog" sendiri. */}
    <Popup message={kurangBayar} title="Pembayaran kurang" onClose={() => setKurangBayar(null)} />
    {/* Stok klinik benar-benar keluar saat pembayaran: penolakan "Stok tidak cukup"
        dari database naik jadi popup yang sama dengan proses stok lain. */}
    {!kurangBayar && <StokKurangDariPesan pesan={saveError}
      petunjuk="Kurangi jumlahnya atau ganti dengan obat lain yang stoknya ada, lalu simpan ulang." />}
    <RacikanBelumSiapDialog open={!!konfirmasiRacikan}
      onCancel={() => setKonfirmasiRacikan(null)}
      onConfirm={() => {
        const data = konfirmasiRacikan;
        racikanDikonfirmasi.current = true;
        setKonfirmasiRacikan(null);
        if (data) void submit(data, bayarVisit);
      }} />
    <form action={data => {
      if (sourceChanged) return Promise.resolve();
      // "Bayar & Selesai" dicatat lunas di server berapa pun nominalnya, jadi uang kurang ditahan di sini.
      const kurang = !mixed && data.get("finalize") === "1" ? pesanKurangBayar(bayar, sisa) : null;
      if (kurang) { setKurangBayar(kurang); return Promise.resolve(); }
      if (racikanPending && !racikanDikonfirmasi.current) { setKonfirmasiRacikan(data); return Promise.resolve(); }
      return submit(data, bayarVisit);
    }} ref={attachForm} onInput={capture} onChange={capture}>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="requestKey" value={submissionKey} />
      {demoEnabled && !editMode && <>
        <input type="hidden" name="demo_policy_id" value={demoPolicyId}/>
        <input type="hidden" name="demo_employee_ids" value={JSON.stringify(demoEmployees)}/>
        <input type="hidden" name="demo_received" value={bayar}/>
      </>}
      <input type="hidden" name="items" value={items} />
      <input type="hidden" name="discount" value={discount} />
      <input type="hidden" name="voucherCode" value={voucher} />
      <input type="hidden" name="poinDigunakan" value={poinDipakai} />
      <input type="hidden" name="paid_status" value={paidStatus} />
      <input type="hidden" name="metode_bayar" value={metode} />
      {mixed && !editMode && <input type="hidden" name="split_payments" value={JSON.stringify(splitPayments)} />}
      <input type="hidden" name="dp_amount" value={editMode ? dpPaid : totalDiterima} />
      <input type="hidden" name="dp_date" value={initialDpDate ?? today} />
      {editMode && <input type="hidden" name="edit_reason" value={reason} />}
      {kurangDp > 0 && bolehTerobosDp && <input type="hidden" name="dp_override_reason" value={dpOverrideReason} />}

      {recovered && <div className="p2ban">Draf dipulihkan. Periksa isian sebelum menyimpan.
        <button type="button" className="btn-def" onClick={discard}>Buang draf</button>
      </div>}
      {sourceChanged && <div className="p2ban" role="alert">
        <div>Data tagihan sumber berubah atau draf lama belum memiliki pembanding. Draf pembayaran lama belum dapat disimpan.
          <br />Subtotal rekam medis terbaru: <b>{rp(latestSourceSubtotal)}</b> sebelum diskon dan pajak.
          <br />Periksa invoice yang sudah tersimpan sebelum mengganti draf. Memuat tagihan terbaru mengganti isian pembayaran yang belum tersimpan.</div>
        <button type="button" className="btn-def" onClick={discard}>Muat tagihan terbaru</button>
      </div>}
      {(storageError || saveError) && <div className="p2ban" role="alert">{storageError || saveError}</div>}

      {/* Header pasien */}
      <div className="card" style={{ marginBottom: 14, padding: 18 }}>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <div style={{ width: 96, height: 96, borderRadius: 12, background: "var(--sf1)", border: ".5px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
            {patient.photo ? <img src={patient.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <i className="ti ti-paw" style={{ fontSize: 40, color: "var(--td)" }} />}
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 19, fontWeight: 800, color: "var(--sb)" }}>{patient.name}</span>
              <span className="bge b">{patient.species}</span>
            </div>
            <Pair label="Pemilik" value={patient.owner} />
            <Pair label="No. HP" value={patient.phone} />
            <Pair label="Alamat" value={patient.address} />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <Pair label="No. Invoice" value={patient.noInvoice} />
            <Pair label="Tanggal" value={patient.tanggal} />
            <Pair label="Dokter" value={patient.dokter} />
            <Pair label="Jenis Layanan" value={patient.jenisLayanan} />
          </div>
        </div>
      </div>

      {!editMode && demoPolicy && demoStaff.length > 0 && <div className="card" style={{marginBottom:12}}>
        <label><input type="checkbox" checked={demoEnabled} onChange={e=>{setDemoEnabled(e.target.checked);setDemoPolicyId(demoPolicy.id);}}/> Gunakan aturan DEMO</label>
        <p style={{fontSize:12}}>{demoPolicy.name} · pool jasa {demoPolicy.incentivePercent}%. Checkout awal lunas. <Link href="/klinik/aturan-demo">Lihat aturan</Link></p>
        {demoEnabled && <>
          <p style={{fontSize:12}}>Pilih penerima dari petugas yang tercatat menangani pasien. Satu pool dibagi rata; admin tidak masuk dasar insentif.</p>
          {demoStaff.map(person=><label key={person.id} style={{display:"block",fontSize:12}}><input type="checkbox" checked={demoEmployees.includes(person.id)} onChange={e=>setDemoEmployees(e.target.checked ? [...demoEmployees,person.id] : demoEmployees.filter(id=>id!==person.id))}/>{person.nama} — {person.jabatan}</label>)}
          <p style={{fontSize:12}}>Biaya admin {demoPolicy.feeBearer==="customer" ? "pelanggan" : "perusahaan"}: {rp(customerFee+companyFee)}. {mixed ? "Nominal bagian diisi sebelum admin; biaya pelanggan ditambahkan ke metode masing-masing." : "Total pelanggan sudah termasuk admin."}</p>
          {demoError && <div role="alert">{demoError}</div>}
        </>}
      </div>}
      <div className="card" style={{ marginBottom: 12 }}>
        <span className="flab">{editMode ? "Penjual historis" : "Kasir"}</span>
        <div>{editMode ? `${sealedSalespersonName} · mengikuti invoice tersimpan` : `${cashierName} · akun yang sedang masuk`}</div>
        {editMode && <div style={{fontSize:11}}>Kasir: {cashierName}</div>}
      </div>

      <div className={styles.layout} style={{ display: "grid", gap: 14, alignItems: "start" }}>
        {/* ===== KIRI: rincian tagihan ===== */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--posb)", letterSpacing: ".02em", marginBottom: 12, borderBottom: "2px solid var(--posb)", paddingBottom: 8, display: "inline-block" }}>
            <i className="ti ti-clipboard-list" /> RINCIAN TAGIHAN
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb)", letterSpacing: ".03em", marginBottom: 10 }}>RINCIAN LAYANAN DAN OBAT</div>

          <ItemTable title="OBAT" icon="ti-pill" color="#7c3aed" rows={obat} setRows={setObat} master={masterObat} listId="mst-obat" allowUnits={manualUnitsEnabled} serviceStaff={serviceStaff} sealedPerformers={editMode} defaultDoctorId={visitDoctorId} openSourceIds={openSourceIds} packages={editMode ? NO_PACKAGES : packages} />
          <ItemTable title="JASA / Tindakan" icon="ti-stethoscope" color="var(--posb)" rows={jasa} setRows={setJasa} master={masterJasa} listId="mst-jasa" serviceRows serviceStaff={serviceStaff} sealedPerformers={editMode} defaultDoctorId={visitDoctorId} openSourceIds={openSourceIds} groomingDoctorRequired={groomingDoctorRequired} groomingApplies={groomingApplies} packages={editMode ? NO_PACKAGES : packages} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
            <div style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--posb)", marginBottom: 4 }}>CATATAN RESEP</div>
              <div style={{ fontSize: 11, color: "var(--tm)", lineHeight: 1.5 }}>{catatanResep || "—"}</div>
            </div>
            <div>
              {customerFee > 0 && <SumRow label="Admin pembayaran DEMO" value={rp(customerFee)}/>}
              <SumRow label="Subtotal (Obat + Jasa)" value={rp(subtotal)} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0" }}>
                <span style={{ fontSize: 11.5, color: "var(--tm)" }}>Diskon</span>
                <NumberInput className="fi" type="number" min={0} step={1} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} style={{ width: 100, textAlign: "right" }} />
              </div>
              {promoVal > 0 && <SumRow label="Promo otomatis" value={`- ${rp(promoVal)}`} />}
              {golonganVal > 0 && <SumRow label="Diskon golongan pelanggan" value={`- ${rp(golonganVal)}`} />}

              {/* Kode voucher: mesin & syaratnya sama dengan kasir petshop. */}
              {!editMode && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", gap: 8 }}>
                <span style={{ fontSize: 11.5, color: "var(--tm)" }}>Kode voucher / kampanye</span>
                <input className="fi" value={voucher} placeholder="opsional"
                  onChange={(e) => setVoucher(e.target.value)}
                  style={{ width: 120, textAlign: "right", textTransform: "uppercase", borderColor: tolakVoucher ? "#fca5a5" : undefined }} />
              </div>}
              {tolakVoucher && (
                <div style={{ fontSize: 10, color: "#b91c1c", textAlign: "right", marginTop: -2 }}>{tolakVoucher}</div>
              )}
              {voucherVal > 0 && <SumRow label="Potongan voucher" value={`- ${rp(voucherVal)}`} />}

              {/* Poin loyalty — sama seperti kasir petshop: 1 poin = Rp1, hanya
                  terpotong kalau tagihan dilunasi sekarang. */}
              {!editMode && bekal.poinSaldo > 0 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: "var(--tm)" }}>
                    Pakai poin <span style={{ fontSize: 9.5, color: "var(--td)" }}>(saldo {bekal.poinSaldo.toLocaleString("id-ID")})</span>
                  </span>
                  <NumberInput className="fi" type="number" min={0} max={poinMaks} step={1}
                    value={poinPakai || ""} placeholder="0"
                    onChange={(e) => setPoinPakai(Number(e.target.value))}
                    style={{ width: 100, textAlign: "right" }} />
                </div>
              )}
              {poinDipakai > 0 && <SumRow label="Potongan poin" value={`- ${rp(poinDipakai)}`} />}

              <SumRow label={`PPN ${ppnRate}%`} value={rp(tax)} />
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTop: "1.5px solid var(--bd)" }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--sb)" }}>TOTAL TAGIHAN</span>
                <span style={{ fontSize: 17, fontWeight: 800, color: "var(--posb)" }}>{rp(total)}</span>
              </div>
            </div>
          </div>
          {editMode && (
            <div style={{ marginTop: 12 }}>
              <label className="flab">Alasan perubahan (wajib bila nominal/item berubah)</label>
              <input className="fi" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. salah input harga obat" />
            </div>
          )}
        </div>

        {/* ===== KANAN: panel pembayaran ===== */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Status */}
          <div className="card" style={{ background: paidStatus === "Lunas" ? "#f0fdf4" : "#fff", borderColor: statusColor }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: statusColor, letterSpacing: ".02em" }}>PRATINJAU PEMBAYARAN</span>
              <span className={`bge ${paidStatus === "Lunas" ? "g" : paidStatus === "DP" ? "pu" : "r"}`}>{paidStatus.toUpperCase()}</span>
            </div>
            <p style={{fontSize:11,color:"var(--tm)"}}>Status ini berlaku setelah penyimpanan berhasil; isian ini belum menjadi bukti pembayaran.</p>
            <div style={{ fontSize: 10.5, color: "var(--tm)" }}>Total Tagihan</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--sb)", lineHeight: 1.2 }}>{rp(total)}</div>
            <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 6 }}>Sisa yang Harus Dibayar</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: statusColor }}>{rp(Math.max(0, total - totalDiterima))}</div>
          </div>

          {/* Ringkasan */}
          <div className="card">
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--posb)", marginBottom: 8 }}>RINGKASAN PEMBAYARAN</div>
            <SumRow label="Total Tagihan" value={rp(total)} />
            {initialCreditAmount > 0 && <SumRow label="Pembayaran dialihkan" value={rp(initialCreditAmount)} />}
            <SumRow label="Total Pembayaran" value={rp(totalDiterima)} />
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--bd)" }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>Sisa yang Harus Dibayar</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: statusColor }}>{rp(Math.max(0, total - totalDiterima))}</span>
            </div>
          </div>

          {/* DP */}
          {dpPaid > 0 && (
            <div className="card" style={{ borderColor: "#c4b5fd" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: "#7c3aed" }}>DP PEMBAYARAN</span>
                <span className="bge pu">DP DIBAYAR</span>
              </div>
              <SumRow label="Tanggal DP" value={initialDpDate ?? "—"} />
              <SumRow label="Jumlah DP" value={rp(dpPaid)} />
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--bd)" }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Sisa Setelah DP</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#7c3aed" }}>{rp(sisa)}</span>
              </div>
            </div>
          )}

          {/* Metode */}
          <div className="card">
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--posb)", marginBottom: 8 }}>PILIH METODE PEMBAYARAN</div>
            {!editMode && <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <input type="checkbox" checked={mixed} onChange={event => setMixed(event.target.checked)} />
              Bayar dengan beberapa metode
            </label>}
            {mixed ? <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {splitPayments.map((part, index) => <div key={index} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select className="fi" aria-label={`Metode pembayaran ${index + 1}`} value={part.method}
                  onChange={event => setSplitPayments(parts => parts.map((row, i) => i === index ? { ...row, method: event.target.value } : row))}>
                  {SPLIT_METHODS.map(method => <option key={method}>{method}</option>)}
                </select>
                <NumberInput className="fi" type="number" min={1} step={1} aria-label={`Nominal pembayaran ${index + 1}`} value={part.amount || ""}
                  onChange={event => setSplitPayments(parts => parts.map((row, i) => i === index ? { ...row, amount: Number(event.target.value) } : row))} />
                {splitPayments.length > 2 && <button className="btn-def" type="button" aria-label={`Hapus pembayaran ${index + 1}`}
                  onClick={() => setSplitPayments(parts => parts.filter((_, i) => i !== index))}>×</button>}
              </div>)}
              <button className="btn-def" type="button" disabled={splitPayments.length >= 6}
                onClick={() => setSplitPayments(parts => [...parts, { method: "Tunai", amount: 0 }])}>Tambah metode pembayaran</button>
              <div style={{ fontSize: 11 }}>Satu invoice · total bagian {rp(splitAmount)}</div>
              {splitError && <div role="alert" style={{ color: "#b91c1c", fontSize: 11 }}>{splitError}</div>}
            </div> :
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {METODE_BAYAR.map(({ m, ic, desc }) => (
                <button key={m} type="button" disabled={editMode} onClick={() => { setMetode(m); setBayarManual(false); if (m !== "Tunai") setBayar(0); }} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                  border: `1.5px solid ${metode === m ? "var(--posb)" : "var(--bd)"}`, background: metode === m ? "#eff4ff" : "#fff",
                }}>
                  <span style={{ width: 15, height: 15, borderRadius: "50%", border: `2px solid ${metode === m ? "var(--posb)" : "var(--bd)"}`, background: metode === m ? "var(--posb)" : "#fff", boxShadow: metode === m ? "inset 0 0 0 2.5px #fff" : "none", flexShrink: 0 }} />
                  <i className={`ti ${ic}`} style={{ fontSize: 18, color: metode === m ? "var(--posb)" : "var(--tm)" }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{m}</div>
                    <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{desc}</div>
                  </div>
                </button>
              ))}
            </div>}
          </div>

          {/* Penerimaan */}
          {!mixed && <div className="card">
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--posb)", marginBottom: 8 }}>PENERIMAAN PEMBAYARAN</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, color: "var(--tm)" }}>Jumlah Bayar</span>
              <NumberInput className="fi" type="number" min={0} step={1} disabled={editMode} value={bayar || ""} aria-label="Jumlah Bayar" onChange={(e) => { setBayarManual(true); setBayar(Number(e.target.value)); }} style={{ width: 130, textAlign: "right" }} />
              {metode !== "Tunai" && !bayarManual && !editMode && <span style={{ fontSize: 10, color: "var(--tm)" }}>otomatis = sisa tagihan</span>}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: "#15803d" }}>Kembalian</span>
              <span style={{ fontWeight: 700, color: "#15803d" }}>{rp(kembalian)}</span>
            </div>
          </div>}

          {kurangDp > 0 && (
            <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e", marginBottom: 8 }}>
              <i className="ti ti-alert-triangle" /> {pesanDpMinimal(total, totalDiterima, minDpPercent)}
              {bolehTerobosDp
                ? " Isi alasan di bawah untuk tetap menyimpan."
                : " Minta OWNER/ADMIN/FINANCE yang menyimpan di bawah minimum."}
            </div>
          )}
          {kurangDp > 0 && bolehTerobosDp && (
            <div className="fg" style={{ marginBottom: 8 }}>
              <label className="flab" htmlFor="dp-override-reason">Alasan di bawah uang muka minimal</label>
              <input className="fi" id="dp-override-reason" maxLength={500} value={dpOverrideReason}
                onChange={(e) => setDpOverrideReason(e.target.value)}
                placeholder="Mis. pelanggan lama, sisanya transfer besok" />
            </div>
          )}

          {/* Aksi */}
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 6 }}>
            {editMode ? (
              <Link href={`/klinik/pembayaran/${visitId}/invoice`} className="btn-def" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 12px", fontSize: 11, textDecoration: "none" }}>
                <i className="ti ti-printer" /> Cetak
              </Link>
            ) : (
              <span className="btn-def" title="Simpan invoice dulu sebelum cetak" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 12px", fontSize: 11, opacity: 0.5, cursor: "not-allowed" }}>
                <i className="ti ti-printer" /> Cetak
              </span>
            )}
            <SubmitButton className="btn-acc" name="finalize" value="0" disabled={sourceChanged || !!splitError || !!demoError || (demoEnabled && !mixed && bayar < total)} busy={leaving} icon="ti-device-floppy" pendingText="Menyimpan…" style={{ justifyContent: "center", padding: "9px 0", background: "var(--posb)" }}>{demoEnabled ? "Simpan lunas DEMO" : "Simpan"}</SubmitButton>
            {!editMode && <SubmitButton className="kpos-bayar" name="finalize" value="1" disabled={sourceChanged || !!splitError || !!demoError || (demoEnabled && !mixed && bayar < total)} busy={leaving} icon="ti-circle-check" pendingText="Memproses…" style={{ background: "#16a34a" }}>Bayar &amp; Selesai</SubmitButton>}
          </div>
        </div>
      </div>
    </form>
  </>);
}

function Pair({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 6, padding: "2px 0", fontSize: 12 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ color: "var(--tx)", fontWeight: 500 }}>: {value || "—"}</span>
    </div>
  );
}
function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11.5 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}

/** G: peringatan racikan belum siap. Pembayaran tetap boleh diteruskan setelah dikonfirmasi. */
function RacikanBelumSiapDialog({ open, onConfirm, onCancel }: { open: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && !ref.current?.open) ref.current?.showModal(); }, [open]);
  if (!open) return null;
  return <dialog ref={ref} role="alertdialog" aria-label="Racikan belum siap"
    style={{ margin: "auto", border: ".5px solid #fcd34d", borderRadius: 12, padding: 20, maxWidth: 420, width: "calc(100% - 32px)" }}>
    <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, color: "#92400e", marginBottom: 8 }}>
      <i className="ti ti-alert-triangle" style={{ fontSize: 20 }} /> Racikan belum siap
    </div>
    <div style={{ fontSize: 13, color: "var(--sb)", marginBottom: 16 }}>Ada racikan yang belum siap diserahkan. Lanjutkan pembayaran?</div>
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <button type="button" className="btn-def" onClick={onCancel}>Batal</button>
      <button type="button" className="btn-acc" autoFocus onClick={onConfirm}>Lanjutkan pembayaran</button>
    </div>
  </dialog>;
}
