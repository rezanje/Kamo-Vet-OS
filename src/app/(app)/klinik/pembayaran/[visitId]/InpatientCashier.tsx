"use client";
import { useState, type ComponentProps } from "react";
import Link from "next/link";
import { ItemTable, type MasterItem, type PackageOption } from "./PembayaranForm";
import { Popup } from "@/components/Popup";
import { isiDitagihPerPaket, kenaliPaket, pecahPaket } from "@/lib/paket-klinik";
import { PaymentChargeTotal, PaymentSummary, SumRow, type PaymentPatient } from "./PaymentPresentation";
import { SimpanBayarForm } from "../../rawat-inap/[id]/tagihan/SimpanBayarForm";
import type { InpatientCashierData } from "@/lib/inpatient-cashier";

type Line = ComponentProps<typeof ItemTable>["rows"][number];
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
export function InpatientCashier({ data, patient, catatanResep = null, cashierName = "Akun kasir", visitId, recordId, requestKey, masterObat, masterJasa, ppnRate, minDpPercent, bolehTerobos, packages = [] }: {
  data: InpatientCashierData; patient: PaymentPatient; catatanResep?: string | null; cashierName?: string;
  visitId: string; recordId: string; requestKey: string; masterObat: MasterItem[]; masterJasa: MasterItem[]; ppnRate: number; minDpPercent: number; bolehTerobos: boolean;
  /** Paket (Grup) dengan resep utuh: dipilih dari daftar Obat lalu dipecah jadi isinya (Anisa 2 Nov). */
  packages?: PackageOption[];
}) {
  // Only the authoritative pending set enters this cart. No outpatient draft hook,
  // historical invoice prefill or visit-default performer rewrite belongs here.
  const initial = (kind: string): Line[] => data.rows.filter(row => (row.jenis === "jasa" ? "jasa" : "obat") === kind).map(row => ({
    key: row.id, prescription_item_id: row.id, item_id: row.item_id, deskripsi: row.nama_obat, qty: Number(row.qty), harga: Number(row.harga), satuan: row.satuan,
    recipe_id: row.compound_recipe_id, service_performers: row.service_performers, terkunci: !!row.compound_recipe_id, diskon_persen: 0,
  }));
  // Penanda paket di keranjang rawat inap hanya untuk tampilan (satu baris per paket); yang
  // dikirim tetap baris isinya, karena tagihan rawat inap tidak menyimpan asal paket.
  const [awal] = useState(() => {
    const obat0 = initial("obat"), jasa0 = initial("jasa");
    const siap = packages.filter(option => option.resep);
    if (!siap.length) return { obat: obat0, jasa: jasa0 };
    const faktor = (itemId: string, satuan: string | null | undefined) => {
      const item = masterObat.find(row => row.id === itemId);
      if (item) return !satuan || satuan === item.unit ? 1 : item.units?.find(unit => unit.unit === satuan)?.factor ?? null;
      return masterJasa.some(row => row.id === itemId) ? 1 : null;
    };
    const semua = kenaliPaket([...obat0, ...jasa0], siap.map(option => ({
      id: option.id, harga: masterObat.find(row => row.id === option.id)?.harga ?? null, perPaket: isiDitagihPerPaket(option.resep!),
    })), faktor);
    const jasaPaket = semua.slice(obat0.length).filter(row => row.package_item_id).map(row => ({ ...row, jenis: "jasa" }));
    return { obat: [...semua.slice(0, obat0.length), ...jasaPaket], jasa: semua.slice(obat0.length).filter(row => !row.package_item_id) };
  });
  const [obat, setObat] = useState<Line[]>(awal.obat);
  const [jasa, setJasa] = useState<Line[]>(awal.jasa);
  const [pesanPaket, setPesanPaket] = useState<string | null>(null);
  const hargaNormal = (itemId: string, satuan: string, faktor: number) => {
    const item = masterObat.find(row => row.id === itemId) ?? masterJasa.find(row => row.id === itemId);
    if (!item) return 0;
    return item.units?.find(unit => unit.unit === satuan)?.sell_price ?? item.harga * faktor;
  };
  const aturJumlahPaket = (packageId: string, jumlah: number) => {
    if (!Number.isInteger(jumlah) || jumlah < 1) return;
    const skala = (list: Line[]) => list.map(row => row.package_item_id === packageId && Number(row.package_qty) > 0
      ? { ...row, qty: Math.round((row.qty / Number(row.package_qty)) * jumlah), package_qty: jumlah } : row);
    setObat(skala); setJasa(skala);
  };
  const hapusPaket = (packageId: string) => {
    setObat(list => list.filter(row => row.package_item_id !== packageId));
    setJasa(list => list.filter(row => row.package_item_id !== packageId));
  };
  /** Paket dipilih di baris obat `i`: diganti isi paket (harga paket dibagi ke isinya). */
  const pilihPaket = (i: number, packageId: string) => {
    const option = packages.find(row => row.id === packageId);
    const item = masterObat.find(row => row.id === packageId);
    if (!option?.resep || !item) { setPesanPaket("Isi paket ini belum terbaca. Muat ulang halaman lalu coba lagi."); return; }
    const sudah = [...obat, ...jasa].find(row => row.package_item_id === packageId);
    if (sudah) { setObat(list => list.filter((_, j) => j !== i)); aturJumlahPaket(packageId, Number(sudah.package_qty ?? 1) + 1); return; }
    const hasil = pecahPaket(option.resep, item.harga, 1, hargaNormal);
    if (hasil.error !== null) { setPesanPaket(hasil.error); return; }
    const baru = hasil.baris.map((row): Line => ({
      key: crypto.randomUUID(), deskripsi: row.nama, qty: row.qty, harga: row.harga, item_id: row.item_id, satuan: row.satuan,
      kategori: row.kategori, diskon_persen: 0, package_item_id: packageId, package_qty: 1, jenis: row.jenis,
    }));
    setObat(list => [...list.slice(0, i), ...baru, ...list.slice(i + 1)]);
  };
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
    jenis: jasa.includes(row) || row.jenis === "jasa" ? "jasa" : "obat", compound_recipe_id: row.recipe_id ?? null, service_performers: row.service_performers ?? null, diskon_persen: row.diskon_persen ?? 0 }));
  return <SimpanBayarForm recordId={recordId} visitId={visitId} requestKey={requestKey} remaining={remaining} pendingCount={rows.length} accounts={data.quote.accounts}
    compoundPending={data.compound_pending} applyCredit={Math.min(data.quote.credit, data.quote.debt)} bolehTerobos={bolehTerobos} dpOpsional={hasPrior ? Math.round(remaining / 2) : undefined}
    extraFields={{ pending_snapshot: data.snapshot, pending_rows: JSON.stringify(payload), cart_reason: reason }}
    presentation={{ patient, cashierName, catatanResep,
      cart: <>
        <Popup message={pesanPaket} title="Paket belum bisa dipakai" onClose={() => setPesanPaket(null)} />
        <ItemTable title="OBAT" icon="ti-pill" color="#7c3aed" rows={obat} setRows={setObat} master={masterObat} listId="ranap-obat" allowUnits sealedPerformers discountsDisabled
          packages={packages} onPickPackage={pilihPaket} onPackageQty={aturJumlahPaket} onRemovePackage={hapusPaket} />
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
