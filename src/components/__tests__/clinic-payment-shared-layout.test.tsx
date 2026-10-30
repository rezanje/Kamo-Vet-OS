// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
vi.mock("@/app/(app)/klinik/rawat-inap/[id]/tagihan/actions", () => ({ simpanBayar: vi.fn() }));
import { PembayaranForm } from "@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";
import { InpatientCashier } from "@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier";
import type { InpatientCashierData } from "@/lib/inpatient-cashier";
const patient = { photo: null, name: "Pasien Fiktif", species: "Kucing", owner: "Pemilik Fiktif", phone: "080000000000", address: "Alamat fiktif", dokter: "Dokter Fiktif", jenisLayanan: "Rawat Inap", noInvoice: "(tahap baru)", tanggal: "01/11/2026" };
const data: InpatientCashierData = { snapshot: "pending-only", rows: [], history: [], receipts: [], applications: [], tax_settings: { mode_pkp: false, ppn_rate: 0 }, quote: { token: "quote", remaining: 0, pending: 0, debt: 0, credit: 0, subtotal: 0, tax: 0, amount: 0, excess: 0, accounts: [{ method: "Tunai", code: "1101", name: "Kas Fiktif", bank: null, number: null }, { method: "Transfer", code: "1102", name: "Rekening Fiktif", bank: "Bank Fiktif", number: "000000" }] } };
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("keeps correction print bound to its explicit issued invoice and the edit reason below the full-width summary", async () => {
  await act(async () => root.render(<PembayaranForm visitId="outpatient" requestKey="key" patient={patient} initialObat={[]} initialJasa={[]} catatanResep={null} editMode targetInvoiceId="exact-issued" bekal={{ promos: [], aturanDiskon: [], golonganPersen: 0, infoBarang: {}, vouchers: [], hariIni: "2026-11-01", customerId: null, categoryId: null, poinSaldo: 0, rupiahPerPoin: 1 }} />));
  expect(host.querySelector('a[href="/klinik/pembayaran/outpatient/invoice?invoice_id=exact-issued"]')).not.toBeNull();
  const reason = [...host.querySelectorAll('label')].find(label => label.textContent?.startsWith('Alasan perubahan'))!.parentElement!;
  expect(reason.parentElement?.className).toBe('crm-sec');
});
it("does not invent a zero historical DP/payment total when an owner advance exists", async () => {
  const advance = { ...data, rows: [{id:"pending",item_id:"sku",nama_obat:"Jasa fiktif",qty:1,harga:750000,satuan:"pcs",jenis:"jasa"}], quote:{...data.quote,remaining:500000,pending:750000,subtotal:750000,credit:250000} };
  await act(async () => root.render(<InpatientCashier data={advance} patient={patient} visitId="ward" recordId="stay" requestKey="key" masterObat={[]} masterJasa={[]} ppnRate={0} minDpPercent={50} bolehTerobos={false} />));
  expect(host.textContent).toContain("Penerimaan baruRp 0");
  expect(host.textContent).toContain("Saldo pemilik tersediaRp 250.000");
  expect(host.textContent).toContain("Sisa yang Harus DibayarRp 500.000");
  expect(host.textContent).not.toContain("Total PembayaranRp 0");
  expect(host.textContent).not.toContain("Jumlah DPRp 0");
});
it("renders the actual outpatient patient header, layout/CSS and panel/control order on inpatient, not just ItemTable", async () => {
  await act(async () => root.render(<PembayaranForm visitId="outpatient" requestKey="key" patient={patient} initialObat={[]} initialJasa={[]} catatanResep="Catatan fiktif" bekal={{ promos: [], aturanDiskon: [], golonganPersen: 0, infoBarang: {}, vouchers: [], hariIni: "2026-11-01", customerId: null, categoryId: null, poinSaldo: 0, rupiahPerPoin: 1 }} />));
  const outpatientLayout = host.querySelector('[class*="layout"]')!;
  expect(outpatientLayout).not.toBeNull();
  const css = outpatientLayout.className;
  const outpatientPatientHeader = host.querySelector('form > .card')!.outerHTML;
  const outpatientMethodCards = [...host.querySelectorAll('[data-payment-method]')].slice(0, 2).map(node => node.outerHTML);
  const order = ["RINCIAN TAGIHAN", "RINCIAN LAYANAN DAN OBAT", "CATATAN RESEP", "PRATINJAU PEMBAYARAN", "RINGKASAN PEMBAYARAN", "PILIH METODE PEMBAYARAN", "PENERIMAAN PEMBAYARAN", "Cetak", "Simpan", "Bayar & Selesai"];
  for (const label of order) expect(host.textContent).toContain(label);
  await act(async () => root.render(<InpatientCashier data={data} patient={patient} catatanResep="Catatan fiktif" visitId="ward" recordId="stay" requestKey="key" masterObat={[]} masterJasa={[]} ppnRate={0} minDpPercent={50} bolehTerobos={false} />));
  for (const value of [patient.name, patient.species, patient.owner, patient.phone, patient.address, patient.dokter, patient.tanggal]) expect(host.textContent).toContain(value);
  const wardLayout = host.querySelector('[class*="layout"]');
  expect(wardLayout?.className).toBe(css);
  expect(host.querySelector('form > .card')!.outerHTML).toBe(outpatientPatientHeader);
  expect([...host.querySelectorAll('[data-payment-method]')].map(node => node.outerHTML)).toEqual(outpatientMethodCards);
  const text = wardLayout!.textContent!;
  let previous = -1;
  for (const label of order) { const index = text.indexOf(label); expect(index, label).toBeGreaterThan(previous); previous = index; }
  expect(host.querySelector('[aria-label="Jumlah Bayar"]')).not.toBeNull();
  expect([...host.querySelectorAll('[data-payment-method]')].map(node => node.getAttribute('data-payment-method'))).toEqual(["Tunai", "Transfer"]);
  expect(host.textContent).not.toContain("Kode voucher");
  expect(host.textContent).not.toContain("Kembalian");
});
