"use client";

import { METODE_BAYAR as SPLIT_METHODS } from "@/lib/kas-akun";
import { validateSplitPaymentTotal, type SplitPaymentDraft } from "@/lib/clinic-split-payment";

import type { PilihanPenjual } from "@/lib/penjual";
import type { ItemUnit } from "@/lib/satuan";
import { useClinicDraft } from "@/components/useClinicDraft";
import { useState } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { bayarVisit } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";
import { METODE_BAYAR } from "@/lib/metode-bayar";
import { hitungPromoKeranjang } from "@/lib/promo-hitung";
import { diskonGolonganKeranjang } from "@/lib/harga-golongan";
import { normalizeKode, pesanVoucherDitolak, potonganVoucher } from "@/lib/voucher";
import { hargaNetto, nilaiBaris, type BekalPotongan } from "@/lib/tagihan-klinik";

type Line = {
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
};
export type MasterItem = { id: string; code: string; name: string; unit: string; harga: number; units?: ItemUnit[] };
type Patient = {
  photo: string | null; name: string; species: string; owner: string; phone: string; address: string;
  dokter: string; jenisLayanan: string; noInvoice: string; tanggal: string;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const labelMaster = (it: MasterItem) => `${it.code} — ${it.name}`;

export function ItemTable({ title, icon, color, rows, setRows, master, listId, allowUnits = false }: {
  title: string; icon: string; color: string; rows: Line[]; setRows: (r: Line[]) => void;
  master: MasterItem[]; listId: string; allowUnits?: boolean;
}) {
  const set = (i: number, patch: Partial<Line>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows([...rows, { deskripsi: "", qty: 1, harga: 0, item_id: null, diskon_persen: 0 }]);
  const del = (i: number) => setRows(rows.filter((_, j) => j !== i));
  const subtotal = rows.reduce((a, r) => a + nilaiBaris(r), 0);

  // Cocokkan ketikan ke master SKU. Kalau kena, item_id + harga jual ikut terisi
  // supaya baris ini memotong stok saat disimpan; kalau tidak kena, item_id
  // dikosongkan lagi — baris lama yang namanya diedit tidak boleh menyeret
  // item_id barang yang berbeda.
  const byLabel = new Map(master.map((it) => [labelMaster(it), it]));
  const byName = new Map(master.map((it) => [it.name.toLowerCase(), it]));
  const setNama = (i: number, v: string) => {
    const it = byLabel.get(v) ?? byName.get(v.trim().toLowerCase());
    set(i, it
      ? { deskripsi: it.name, item_id: it.id, harga: it.harga, satuan: it.unit, prescription_item_id: null, recipe_id: null }
      : {
          deskripsi: v, item_id: null, prescription_item_id: null, recipe_id: null,
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
      <datalist id={listId}>
        {master.map((it) => <option key={it.id} value={labelMaster(it)} />)}
      </datalist>
      {/* Tabel ikut menyempit di layar kecil sampai kolom Nama tidak terbaca —
          diberi lebar minimum lalu digeser mendatar, sama seperti tabel lain. */}
      <div style={{ overflowX: "auto" }}>
      <table className="tbl" style={{ minWidth: 520 }}>
        <thead><tr><th style={{ width: 26 }}>No.</th><th style={{ minWidth: 180 }}>Nama</th><th style={{ width: 54, textAlign: "center" }}>Qty</th>{allowUnits && <th style={{ width: 100 }}>Satuan</th>}<th style={{ width: 110, textAlign: "right" }}>Harga Satuan</th><th style={{ width: 66, textAlign: "center" }}>Disk %</th><th style={{ width: 100, textAlign: "right" }}>Subtotal</th><th style={{ width: 24 }} /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input className="fi" list={listId} value={r.deskripsi} placeholder="Ketik / pilih dari master" onChange={(e) => setNama(i, e.target.value)} style={{ flex: 1, minWidth: 0 }} />
                  {r.deskripsi.trim() && !r.item_id && (
                    <i className="ti ti-alert-triangle" title="Bukan dari master — stok tidak akan berkurang" style={{ color: "#d97706", fontSize: 13, flexShrink: 0 }} />
                  )}
                </div>
              </td>
              <td>
                <input className="fi" type="number" min={1} value={r.qty}
                  onChange={(e) => set(i, { qty: Number(e.target.value) })}
                  readOnly={r.terkunci} disabled={r.terkunci}
                  title={r.terkunci ? "Dihitung otomatis dari lama rawat inap" : undefined}
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
              <td><input className="fi" type="number" min={0} step="any" value={r.harga} onChange={(e) => set(i, { harga: Number(e.target.value) })} style={{ textAlign: "right" }} /></td>
              <td>
                <input className="fi" type="number" min={0} max={100} step="any"
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
                  : <i className="ti ti-x" onClick={() => del(i)} style={{ cursor: "pointer", color: "#dc2626" }} />}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={allowUnits ? 8 : 7} style={{ textAlign: "center", color: "var(--td)", fontSize: 10.5, padding: "10px 0" }}>Belum ada item.</td></tr>}
        </tbody>
      </table>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 6, fontSize: 11.5 }}>
        <span style={{ fontWeight: 600, color: "var(--tm)" }}>Subtotal {title.split(" ")[0]}</span>
        <span style={{ fontWeight: 700 }}>{rp(subtotal)}</span>
      </div>
    </div>
  );
}

export function PembayaranForm({ visitId, requestKey, patient, initialObat, initialJasa, masterObat = [], masterJasa = [], bekal, catatanResep, ppnRate = 0, initialDiscount = 0, initialDpAmount = 0, initialCreditAmount = 0, initialDpDate = null, initialMetode = "Tunai", editMode = false, salespeople = [], initialSalespersonId = "", sealedSalespersonName = "Tanpa penjual", manualUnitsEnabled = false, draftUserId = "", draftScope = `payment:${visitId}:new` }: {
  visitId: string; requestKey: string; patient: Patient; initialObat: Line[]; initialJasa: Line[]; catatanResep: string | null;
  masterObat?: MasterItem[]; masterJasa?: MasterItem[]; bekal: BekalPotongan;
  draftUserId?: string; draftScope?: string;
  manualUnitsEnabled?: boolean;
  salespeople?: PilihanPenjual[]; initialSalespersonId?: string; sealedSalespersonName?: string;
  ppnRate?: number;
  initialDiscount?: number; initialDpAmount?: number; initialCreditAmount?: number; initialDpDate?: string | null; initialMetode?: string; editMode?: boolean;
}) {
  const [obat, setObat] = useState<Line[]>(initialObat);
  const [jasa, setJasa] = useState<Line[]>(initialJasa);
  const [discount, setDiscount] = useState(initialDiscount);
  const [metode, setMetode] = useState(initialMetode);
  const [reason, setReason] = useState("");
  const [voucher, setVoucher] = useState("");
  const [salesperson, setSalesperson] = useState(initialSalespersonId);
  const [mixed, setMixed] = useState(false);
  const [splitPayments, setSplitPayments] = useState<SplitPaymentDraft[]>([{ method: "Tunai", amount: 0 }, { method: "Transfer", amount: 0 }]);

  const barisSemua = [...obat, ...jasa].filter((r) => r.deskripsi.trim() && r.qty > 0);
  // Diskon per baris dipotong lebih dulu; promo/voucher/golongan menghitung dari
  // harga yang sudah didiskon, urutannya sama dengan kasir petshop.
  const subtotal = barisSemua.reduce((a, r) => a + nilaiBaris(r), 0);

  // Potongan ditampilkan di layar dengan rumus yang sama dengan server. Server
  // tetap menghitung ulang saat menyimpan — ini supaya kasir bisa menyebut angka
  // ke pemilik SEBELUM menekan bayar, bukan supaya layar menentukan uang.
  const barisPotongan = barisSemua.map((r) => ({ item_id: r.item_id ?? "", qty: r.qty, harga: hargaNetto(r) }));
  const promoVal = editMode ? 0 : hitungPromoKeranjang(bekal.promos, barisPotongan).reduce((a, p) => a + p.potongan, 0);
  const golonganVal = editMode ? 0 : diskonGolonganKeranjang(
    barisPotongan, bekal.aturanDiskon, bekal.golonganPersen, new Map(Object.entries(bekal.infoBarang)),
  );
  const dasarVoucher = Math.max(0, subtotal - promoVal);
  const voucherRow = bekal.vouchers.find((v) => v.code === normalizeKode(voucher));
  const tolakVoucher = voucher.trim() === "" ? null : pesanVoucherDitolak(voucherRow ?? null, bekal.hariIni, {
    dasar: dasarVoucher, adaPromoOtomatis: promoVal > 0,
    customerId: bekal.customerId, categoryId: bekal.categoryId,
  });
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
  const total = dpp + tax;
  const dpPaid = initialDpAmount;
  const sisa = Math.max(0, total - dpPaid - initialCreditAmount);

  const [bayar, setBayar] = useState(0);
  const splitAmount = splitPayments.reduce((sum, part) => sum + part.amount, 0);
  const totalDiterima = dpPaid + initialCreditAmount + (mixed ? splitAmount : bayar);
  const kembalian = mixed ? 0 : Math.max(0, bayar - sisa);
  let splitError: string | null = null;
  if (mixed) {
    try { validateSplitPaymentTotal(splitPayments, total); }
    catch (error) { splitError = error instanceof Error ? error.message : "Periksa rincian pembayaran."; }
  }
  const paidStatus = totalDiterima >= total && total > 0 ? "Lunas" : totalDiterima > 0 ? "DP" : "Belum Lunas";
  const statusColor = paidStatus === "Lunas" ? "#15803d" : paidStatus === "DP" ? "#7c3aed" : "#b91c1c";

  const { submissionKey, attachForm, capture, recovered, discard, storageError, saveError, submit } = useClinicDraft({
    userId: draftUserId, scope: draftScope, requestKey,
    snapshot: { obat, jasa, discount, metode, reason, voucher, poinPakai, bayar, salesperson, mixed, splitPayments },
    optionalSnapshotKeys: ["mixed", "splitPayments"],
    restore: value => {
      const restoreRows = (saved: Line[], initial: Line[]) => {
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
      setVoucher(value.voucher); setPoinPakai(value.poinPakai); setBayar(value.bayar); setSalesperson(value.salesperson);
      setMixed(!editMode && value.mixed === true);
      setSplitPayments(Array.isArray(value.splitPayments) ? value.splitPayments : [{ method: "Tunai", amount: 0 }, { method: "Transfer", amount: 0 }]);
    },
  });

  const items = JSON.stringify([
    ...obat.map((r) => ({ ...r, jenis: "obat" })),
    ...jasa.map((r) => ({ ...r, jenis: "jasa" })),
  ].filter((r) => r.deskripsi.trim()));
  const today = hariIniWIB();

  return (
    <form action={data => submit(data, bayarVisit)} ref={attachForm} onInput={capture} onChange={capture}>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="requestKey" value={submissionKey} />
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

      {recovered && <div className="p2ban">Draf dipulihkan. Periksa isian sebelum menyimpan.
        <button type="button" className="btn-def" onClick={discard}>Buang draf</button>
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

      <div className="card" style={{ marginBottom: 12 }}>
        <label className="flab" htmlFor="clinic-salesperson">Penjual / dokter / petugas</label>
        {editMode ? <div>{sealedSalespersonName} · mengikuti invoice tersimpan</div> : (
          <select id="clinic-salesperson" className="fi" name="salesperson_id" value={salesperson} onChange={event => setSalesperson(event.target.value)}>
            <option value="">Tanpa penjual</option>
            {salespeople.map(person => <option key={person.id} value={person.id}>{person.nama}{person.jabatan ? ` — ${person.jabatan}` : ""}</option>)}
          </select>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 14, alignItems: "start" }}>
        {/* ===== KIRI: rincian tagihan ===== */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--posb)", letterSpacing: ".02em", marginBottom: 12, borderBottom: "2px solid var(--posb)", paddingBottom: 8, display: "inline-block" }}>
            <i className="ti ti-clipboard-list" /> RINCIAN TAGIHAN
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb)", letterSpacing: ".03em", marginBottom: 10 }}>RINCIAN LAYANAN DAN OBAT</div>

          <ItemTable title="OBAT" icon="ti-pill" color="#7c3aed" rows={obat} setRows={setObat} master={masterObat} listId="mst-obat" allowUnits={manualUnitsEnabled} />
          <ItemTable title="JASA / Tindakan" icon="ti-stethoscope" color="var(--posb)" rows={jasa} setRows={setJasa} master={masterJasa} listId="mst-jasa" />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
            <div style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--posb)", marginBottom: 4 }}>CATATAN RESEP</div>
              <div style={{ fontSize: 11, color: "var(--tm)", lineHeight: 1.5 }}>{catatanResep || "—"}</div>
            </div>
            <div>
              <SumRow label="Subtotal (Obat + Jasa)" value={rp(subtotal)} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0" }}>
                <span style={{ fontSize: 11.5, color: "var(--tm)" }}>Diskon</span>
                <input className="fi" type="number" min={0} step={1} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} style={{ width: 100, textAlign: "right" }} />
              </div>
              {promoVal > 0 && <SumRow label="Promo otomatis" value={`- ${rp(promoVal)}`} />}
              {golonganVal > 0 && <SumRow label="Diskon golongan pelanggan" value={`- ${rp(golonganVal)}`} />}

              {/* Kode voucher: mesin & syaratnya sama dengan kasir petshop. */}
              {!editMode && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", gap: 8 }}>
                <span style={{ fontSize: 11.5, color: "var(--tm)" }}>Kode voucher</span>
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
                  <input className="fi" type="number" min={0} max={poinMaks} step={1}
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
              <span style={{ fontSize: 11.5, fontWeight: 800, color: statusColor, letterSpacing: ".02em" }}>STATUS PEMBAYARAN</span>
              <span className={`bge ${paidStatus === "Lunas" ? "g" : paidStatus === "DP" ? "pu" : "r"}`}>{paidStatus.toUpperCase()}</span>
            </div>
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
                <input className="fi" type="number" min={1} step={1} aria-label={`Nominal pembayaran ${index + 1}`} value={part.amount || ""}
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
                <button key={m} type="button" disabled={editMode} onClick={() => setMetode(m)} style={{
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
              <input className="fi" type="number" min={0} step={1} disabled={editMode} value={bayar || ""} onChange={(e) => setBayar(Number(e.target.value))} style={{ width: 130, textAlign: "right" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: "#15803d" }}>Kembalian</span>
              <span style={{ fontWeight: 700, color: "#15803d" }}>{rp(kembalian)}</span>
            </div>
          </div>}

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
            <SubmitButton className="btn-acc" name="finalize" value="0" disabled={!!splitError} icon="ti-device-floppy" pendingText="Menyimpan…" style={{ justifyContent: "center", padding: "9px 0", background: "var(--posb)" }}>Simpan</SubmitButton>
            {!editMode && <SubmitButton className="kpos-bayar" name="finalize" value="1" disabled={!!splitError} icon="ti-circle-check" pendingText="Memproses…" style={{ background: "#16a34a" }}>Bayar &amp; Selesai</SubmitButton>}
          </div>
        </div>
      </div>
    </form>
  );
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
