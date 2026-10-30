"use client";
import { useState, type ComponentProps } from "react";
import Link from "next/link";
import { ItemTable, type MasterItem } from "./PembayaranForm";
import { PaymentChargeTotal, PaymentSummary, SumRow, type PaymentPatient } from "./PaymentPresentation";
import { SimpanBayarForm } from "../../rawat-inap/[id]/tagihan/SimpanBayarForm";
import type { InpatientCashierData } from "@/lib/inpatient-cashier";

type Line = ComponentProps<typeof ItemTable>["rows"][number];
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
export function InpatientCashier({ data, patient, catatanResep = null, cashierName = "Akun kasir", visitId, recordId, requestKey, masterObat, masterJasa, ppnRate, minDpPercent, bolehTerobos }: {
  data: InpatientCashierData; patient: PaymentPatient; catatanResep?: string | null; cashierName?: string;
  visitId: string; recordId: string; requestKey: string; masterObat: MasterItem[]; masterJasa: MasterItem[]; ppnRate: number; minDpPercent: number; bolehTerobos: boolean;
}) {
  // Only the authoritative pending set enters this cart. No outpatient draft hook,
  // historical invoice prefill or visit-default performer rewrite belongs here.
  const initial = (kind: string): Line[] => data.rows.filter(row => (row.jenis === "jasa" ? "jasa" : "obat") === kind).map(row => ({
    key: row.id, prescription_item_id: row.id, item_id: row.item_id, deskripsi: row.nama_obat, qty: Number(row.qty), harga: Number(row.harga), satuan: row.satuan,
    recipe_id: row.compound_recipe_id, service_performers: row.service_performers, terkunci: !!row.compound_recipe_id, diskon_persen: 0,
  }));
  const [obat, setObat] = useState(() => initial("obat"));
  const [jasa, setJasa] = useState(() => initial("jasa"));
  const [reason, setReason] = useState("Konfirmasi keranjang rawat inap");
  const rows = [...obat, ...jasa];
  const subtotal = rows.reduce((sum, row) => sum + row.qty * row.harga, 0);
  const tax = Math.round(subtotal * ppnRate / 100);
  const pending = subtotal + tax;
  // Debt/credit already account for old DP and wallet allocations. Never subtract
  // historical receipts/DP from this authoritative balance a second time.
  const remaining = Math.max(0, data.quote.debt + pending - data.quote.credit);
  const billed = data.history.reduce((sum, invoice) => sum + Number(invoice.total), 0);
  const hasPrior = data.history.some(invoice => invoice.total > 0 && !invoice.correction_pending);
  const payload = rows.map(row => ({ id: row.key ?? row.prescription_item_id, item_id: row.item_id ?? null, nama_obat: row.deskripsi, qty: row.qty, harga: row.harga, satuan: row.satuan ?? null,
    jenis: jasa.includes(row) ? "jasa" : "obat", compound_recipe_id: row.recipe_id ?? null, service_performers: row.service_performers ?? null, diskon_persen: row.diskon_persen ?? 0 }));
  return <SimpanBayarForm recordId={recordId} visitId={visitId} requestKey={requestKey} remaining={remaining} pendingCount={rows.length} accounts={data.quote.accounts}
    compoundPending={data.compound_pending} applyCredit={Math.min(data.quote.credit, data.quote.debt)} bolehTerobos={bolehTerobos} dpOpsional={hasPrior ? Math.round(remaining / 2) : undefined}
    extraFields={{ pending_snapshot: data.snapshot, pending_rows: JSON.stringify(payload), cart_reason: reason }}
    presentation={{ patient, cashierName, catatanResep,
      cart: <>
        <ItemTable title="OBAT" icon="ti-pill" color="#7c3aed" rows={obat} setRows={setObat} master={masterObat} listId="ranap-obat" allowUnits sealedPerformers discountsDisabled />
        <ItemTable title="JASA / Tindakan" icon="ti-stethoscope" color="var(--posb)" rows={jasa} setRows={setJasa} master={masterJasa} listId="ranap-jasa" allowUnits sealedPerformers discountsDisabled />
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
