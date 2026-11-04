"use client";
import { useState, type ComponentProps } from "react";
import Link from "next/link";
import { ItemTable, type MasterItem, type PackageOption } from "./PembayaranForm";
import { PaymentChargeTotal, PaymentSummary, SumRow, type PaymentPatient } from "./PaymentPresentation";
import { SimpanBayarForm } from "../../rawat-inap/[id]/tagihan/SimpanBayarForm";
import { inpatientPackageOptionError, inpatientPackageRowsError, resizeInpatientPackage, type InpatientCashierData } from "@/lib/inpatient-cashier";
import { pecahPaket } from "@/lib/paket-klinik";
import { visitDefaultPerformers, type ServiceStaff } from "@/lib/service-performers";

type Line = ComponentProps<typeof ItemTable>["rows"][number];
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
export function InpatientCashier({ data, patient, catatanResep = null, cashierName = "Akun kasir", visitId, recordId, requestKey, masterObat, masterJasa, packages = [], serviceStaff = [], visitDoctorId = null, groomingDoctorRequired = false, groomingApplies = false, canChangePerformers = true, ppnRate, minDpPercent, bolehTerobos }: {
  data: InpatientCashierData; patient: PaymentPatient; catatanResep?: string | null; cashierName?: string;
  visitId: string; recordId: string; requestKey: string; masterObat: MasterItem[]; masterJasa: MasterItem[]; packages?: PackageOption[];
  /** Tenaga penjual (Dokter / Non-dokter) cabang kunjungan + dokter PJ — sama seperti pembayaran rawat jalan. */
  serviceStaff?: ServiceStaff[]; visitDoctorId?: string | null; groomingDoctorRequired?: boolean; groomingApplies?: boolean;
  /** Andri 4 Nov 2026: kasir/admin/pemilik boleh mengganti Dokter / Non-dokter pada baris pending; dokter tidak (database juga menolak). */
  canChangePerformers?: boolean; ppnRate: number; minDpPercent: number; bolehTerobos: boolean;
}) {
  // Only the authoritative pending set enters this cart. No outpatient draft hook,
  // historical invoice prefill or visit-default performer rewrite belongs here.
  const [rows, setRows] = useState<Line[]>(() => data.rows.map(row => ({
    key: row.id, prescription_item_id: row.id, item_id: row.item_id, deskripsi: row.nama_obat, qty: Number(row.qty), harga: Number(row.harga), satuan: row.satuan,
    recipe_id: row.compound_recipe_id, service_performers: row.service_performers, performers_sealed: !!row.performers_sealed, terkunci: !!row.compound_recipe_id, diskon_persen: 0,
    jenis: row.jenis === "jasa" ? "jasa" : "obat", package_item_id: row.package_item_id, package_qty: row.package_qty,
  })));
  const [reason, setReason] = useState("Konfirmasi keranjang rawat inap");
  const [packageError, setPackageError] = useState<string | null>(null);
  // One cart owns the source rows. The medicine table is only a projection: mixed
  // package services appear on its single card without changing their source kind.
  const inObat = (row: Line) => !!row.package_item_id || row.jenis !== "jasa";
  const obat = rows.filter(inObat);
  const jasa = rows.filter(row => !inObat(row));
  const setTable = (kind: "obat" | "jasa", next: Line[]) => setRows(current => [
    ...current.filter(row => kind === "obat" ? !inObat(row) : inObat(row)),
    ...next.map(row => ({ ...row, jenis: row.jenis ?? kind })),
  ]);
  const packageQty = (id: string, count: number) => setRows(current => resizeInpatientPackage(current, id, count));
  const removePackage = (id: string) => setRows(current => current.filter(row => row.package_item_id !== id));
  const pickPackage = (table: Line[], index: number, id: string) => {
    const option = packages.find(option => option.id === id);
    const item = masterObat.find(item => item.id === id && item.paket);
    const metadataError = inpatientPackageOptionError(option, masterObat, masterJasa);
    if (metadataError || !option?.resep || !item || !Number.isFinite(item.harga) || item.harga < 0) { setPackageError(metadataError ?? "Resep paket belum dapat diverifikasi. Muat ulang sebelum memproses uang."); return; }
    const master = [...masterObat, ...masterJasa];
    const result = pecahPaket(option.resep, item.harga, 1, (itemId, unit, factor) => {
      const component = master.find(row => row.id === itemId);
      return component?.units?.find(row => row.unit === unit)?.sell_price ?? (component?.harga ?? 0) * factor;
    });
    if (result.error) { setPackageError(result.error); return; }
    const selected = table[index];
    const existing = rows.filter(row => row.package_item_id === id);
    if (existing.length) {
      const count = Number(existing[0].package_qty) + 1;
      setRows(current => resizeInpatientPackage(current.filter(row => row !== selected), id, count));
    } else {
      const added: Line[] = result.baris.map(row => ({ key: crypto.randomUUID(), item_id: row.item_id, deskripsi: row.nama,
        qty: row.qty, harga: row.harga, satuan: row.satuan, jenis: row.jenis, kategori: row.kategori,
        package_item_id: id, package_qty: 1, diskon_persen: 0, service_performers: visitDefaultPerformers(visitDoctorId) }));
      setRows(current => [...current.filter(row => row !== selected), ...added]);
    }
  };
  const subtotal = rows.reduce((sum, row) => sum + row.qty * row.harga, 0);
  const tax = Math.round(subtotal * ppnRate / 100);
  const pending = subtotal + tax;
  // Debt/credit already account for old DP and wallet allocations. Never subtract
  // historical receipts/DP from this authoritative balance a second time.
  const remaining = Math.max(0, data.quote.debt + pending - data.quote.credit);
  const billed = data.history.reduce((sum, invoice) => sum + Number(invoice.total), 0);
  const hasPrior = data.history.some(invoice => invoice.total > 0 && !invoice.correction_pending);
  const payload = rows.map(row => ({ id: row.key ?? row.prescription_item_id, item_id: row.item_id ?? null, nama_obat: row.deskripsi, qty: row.qty, harga: row.harga, satuan: row.satuan ?? null,
    jenis: row.jenis === "jasa" ? "jasa" : "obat", package_item_id: row.package_item_id ?? null, package_qty: row.package_qty ?? null, compound_recipe_id: row.recipe_id ?? null, service_performers: row.service_performers ?? null, diskon_persen: row.diskon_persen ?? 0 }));
  const originError = inpatientPackageRowsError(rows, packages, masterObat, masterJasa);
  if (packageError || originError) return <section className="card" role="alert">{packageError ?? originError}</section>;
  return <SimpanBayarForm recordId={recordId} visitId={visitId} requestKey={requestKey} remaining={remaining} pendingCount={rows.length} accounts={data.quote.accounts}
    compoundPending={data.compound_pending} applyCredit={Math.min(data.quote.credit, data.quote.debt)} bolehTerobos={bolehTerobos} dpOpsional={hasPrior ? Math.round(remaining / 2) : undefined}
    extraFields={{ pending_snapshot: data.snapshot, pending_rows: JSON.stringify(payload), cart_reason: reason }}
    presentation={{ patient, cashierName, catatanResep,
      cart: <>
        <ItemTable title="OBAT" icon="ti-pill" color="#7c3aed" rows={obat} setRows={next => setTable("obat", next)} master={masterObat} listId="ranap-obat" allowUnits sealedPerformers packageQuantityLocked={false} discountsDisabled packages={packages} serviceStaff={serviceStaff} defaultDoctorId={visitDoctorId} performersForNewRows performersForPendingRows={canChangePerformers} onPickPackage={(index, id) => pickPackage(obat, index, id)} onPackageQty={packageQty} onRemovePackage={removePackage} />
        <ItemTable title="JASA / Tindakan" icon="ti-stethoscope" color="var(--posb)" rows={jasa} setRows={next => setTable("jasa", next)} master={masterJasa} listId="ranap-jasa" allowUnits sealedPerformers packageQuantityLocked={false} discountsDisabled packages={packages} serviceStaff={serviceStaff} defaultDoctorId={visitDoctorId} serviceRows groomingDoctorRequired={groomingDoctorRequired} groomingApplies={groomingApplies} performersForNewRows performersForPendingRows={canChangePerformers} onPickPackage={(index, id) => pickPackage(jasa, index, id)} onPackageQty={packageQty} onRemovePackage={removePackage} />
        {data.rows.filter(row => row.compound_recipe_id).map(row => <p key={row.id}>Racikan {row.nama_obat}: <Link href={`/klinik/racik/${row.compound_recipe_id}`}>Aksi koreksi / pengembalian bahan</Link> (tidak dikeluarkan ulang saat bayar).</p>)}
        <label className="flab">Alasan / catatan revisi keranjang<input className="fi" aria-label="Alasan revisi keranjang" value={reason} onChange={event => setReason(event.target.value)} minLength={3} maxLength={1000} /></label>
      </>,
      chargeSummary: <>
        <SumRow label="Subtotal (Obat + Jasa)" value={rp(subtotal)} />
        <SumRow label={`PPN ${ppnRate}%`} value={rp(tax)} />
        <SumRow label="Biaya tahap baru (belum terbit)" value={rp(pending)} />
        <SumRow label="Sisa invoice terbit" value={rp(data.quote.debt)} />
        <PaymentChargeTotal total={billed + pending} />
      </>,
      summary: newReceipt => <>
        <PaymentSummary total={billed + pending} totalDiterima={newReceipt} totalDiterimaLabel="Penerimaan baru" remaining={Math.max(0, remaining - newReceipt)}
          paidStatus={remaining <= newReceipt && billed + pending > 0 ? "Lunas" : newReceipt > 0 ? "DP" : "Belum Lunas"}
          extra={<><SumRow label="Saldo pemilik tersedia" value={rp(data.quote.credit)} /><SumRow label="Saldo diterapkan pada tagihan" value={rp(Math.min(data.quote.credit, data.quote.debt + pending))} /></>} />
        <div style={{fontSize:11,color:"var(--tm)"}}>{hasPrior ? `DP lanjutan opsional: ${rp(Math.round(remaining / 2))}` : `DP awal minimal ${minDpPercent}%: ${rp(Math.ceil(pending * minDpPercent / 100))}`}</div>
      </>,
    }} />;
}
