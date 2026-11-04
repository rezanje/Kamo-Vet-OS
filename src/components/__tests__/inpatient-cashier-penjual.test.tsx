// @vitest-environment jsdom
// Andri 3 Nov 2026: di pembayaran rawat inap kasir tidak bisa menambahkan tenaga penjual
// (Dokter / Non-dokter) pada item yang ditambah di kasir. Baris pending dari rekam medis
// tetap tersegel (database tidak mengubah pelaksananya); hanya baris BARU yang boleh diisi.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
import { InpatientCashier } from "@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier";
import type { InpatientCashierData, InpatientCashierRow } from "@/lib/inpatient-cashier";
import type { PackageOption } from "@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";
import type { ResepPaket } from "@/lib/paket-klinik";

const group = "10000000-0000-4000-8000-000000000001";
const material = "10000000-0000-4000-8000-000000000002";
const service = "10000000-0000-4000-8000-000000000003";
const doctor = "20000000-0000-4000-8000-000000000001";
const groomer = "20000000-0000-4000-8000-000000000002";
const staff = [
  { id: doctor, nama: "drh. Fiktif", jabatan: "Dokter Hewan" },
  { id: groomer, nama: "Pendamping Fiktif", jabatan: "Paramedis" },
];
const recipe: ResepPaket = { id: group, name: "Paket Fiktif", komponen: [
  { item_id: material, name: "Bahan Isi", item_type: "Persediaan", base_unit: "pcs", qty: 2, unit: "pcs", factor: 1 },
  { item_id: service, name: "Jasa Isi", item_type: "Jasa", base_unit: "x", qty: 1, unit: "x", factor: 1 },
] };
const packages: PackageOption[] = [{ id: group, name: recipe.name, componentIds: [material, service], perPaket: { [material]: 2, [service]: 1 }, resep: recipe }];
const masterObat = [
  { id: group, name: recipe.name, code: "PK", unit: "paket", harga: 50000, paket: true },
  { id: material, name: "Bahan Isi", code: "BH", unit: "pcs", harga: 5000 },
];
const masterJasa = [{ id: service, name: "Jasa Isi", code: "JS", unit: "x", harga: 40000 }];
const patient = { photo: null, name: "Pasien Fiktif", species: "Kucing", owner: "Pemilik Fiktif", phone: "", address: "", dokter: "drh. Fiktif", jenisLayanan: "Rawat Inap", noInvoice: "(baru)", tanggal: "01/11/2026" };
const data: InpatientCashierData = { tax_settings: { mode_pkp: false, ppn_rate: 0 }, snapshot: "snap", rows: [], history: [], receipts: [], applications: [], quote: { token: "q", remaining: 0, pending: 0, debt: 0, credit: 0, subtotal: 0, tax: 0, amount: 0, excess: 0, accounts: [] } };
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(rows: InpatientCashierRow[] = []) {
  // `serviceStaff` / `visitDoctorId` mirror the props of the outpatient PembayaranForm.
  const extra = { serviceStaff: staff, visitDoctorId: doctor, packages } as Record<string, unknown>;
  await act(async () => root.render(<InpatientCashier {...extra} data={{ ...data, rows }} patient={patient} visitId="visit" recordId="stay" requestKey="key" masterObat={masterObat} masterJasa={masterJasa} ppnRate={0} minDpPercent={50} bolehTerobos={false} />));
}
const payload = (): (InpatientCashierRow & { service_performers?: { doctor_id: string | null; staff_id: string | null } | null })[] =>
  JSON.parse(host.querySelector<HTMLInputElement>('input[name="pending_rows"]')!.value);
const selectValue = async (el: HTMLSelectElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
const tambah = async (table = 0) => act(async () => ([...host.querySelectorAll("button")].filter(el => el.textContent?.trim() === "Tambah")[table]).click());
const pilihNama = async (id: string, name: string) => {
  const inputs = host.querySelectorAll<HTMLInputElement>(`[role="combobox"][id^="${id}"]`);
  await act(async () => inputs[inputs.length - 1].focus());
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(el => el.textContent?.includes(name))!;
  expect(option).toBeDefined();
  await act(async () => option.click());
};

it("item baru yang ditambah kasir punya pilihan Dokter dan Non-dokter, default dokter PJ kunjungan", async () => {
  await render();
  await tambah(0); await pilihNama("ranap-obat", "Bahan Isi");
  const dokter = [...host.querySelectorAll<HTMLSelectElement>("select")].find(el => [...el.options].some(o => o.textContent === "drh. Fiktif"));
  const nonDokter = [...host.querySelectorAll<HTMLSelectElement>("select")].find(el => [...el.options].some(o => o.textContent === "Pendamping Fiktif"));
  expect(dokter, "pemilih Dokter harus ada untuk baris baru").toBeDefined();
  expect(nonDokter, "pemilih Non-dokter harus ada untuk baris baru").toBeDefined();
  expect(payload()[0].service_performers).toEqual({ doctor_id: doctor, staff_id: null });
  await selectValue(nonDokter!, groomer);
  expect(payload()[0].service_performers).toEqual({ doctor_id: doctor, staff_id: groomer });
});

it("baris pending dari rekam medis tetap tersegel: tanpa pemilih, pelaksana lama ikut apa adanya", async () => {
  const sealed = { doctor_id: doctor, doctor_name: "drh. Fiktif", staff_id: null, staff_name: null };
  await render([{ id: "old-1", item_id: material, nama_obat: "Bahan Isi", qty: 1, harga: 5000, satuan: "pcs", jenis: "obat", service_performers: sealed }]);
  expect(host.querySelectorAll("select").length).toBe(0);
  expect(payload()[0].service_performers).toEqual(sealed);
});

it("isi Grup yang dipilih di kasir ranap dapat diberi pelaksana dan default dokter PJ", async () => {
  await render();
  await tambah(0); await pilihNama("ranap-obat", "Paket · Paket Fiktif");
  const rows = payload();
  expect(rows).toHaveLength(2);
  expect(rows.every(row => row.package_item_id === group)).toBe(true);
  expect(rows.every(row => row.service_performers?.doctor_id === doctor)).toBe(true);
  const nonDokter = [...host.querySelectorAll<HTMLSelectElement>("select")].find(el => [...el.options].some(o => o.textContent === "Pendamping Fiktif"));
  expect(nonDokter, "pelaksana paket baru harus bisa diisi").toBeDefined();
  await selectValue(nonDokter!, groomer);
  expect(payload().every(row => row.service_performers?.staff_id === groomer)).toBe(true);
});
