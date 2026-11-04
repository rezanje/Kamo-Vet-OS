// @vitest-environment jsdom
// Andri 4 Nov 2026: "kasir boleh mengganti dokter di rawat inap". Baris pending yang sudah masuk
// (Obat Khusus / catatan / paket) kini punya pemilih Dokter / Non-dokter; racikan tetap terkunci.
// Database menegakkan batasnya (peran, aktif, cabang, bukan tertagih) — layar hanya mengirim pilihan.
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
const doctor2 = "20000000-0000-4000-8000-000000000003";
const nurse = "20000000-0000-4000-8000-000000000002";
const staff = [
  { id: doctor, nama: "drh. Fiktif", jabatan: "Dokter Hewan" },
  { id: doctor2, nama: "drh. Kedua Fiktif", jabatan: "Dokter Hewan" },
  { id: nurse, nama: "Pendamping Fiktif", jabatan: "Paramedis" },
];
const recipe: ResepPaket = { id: group, name: "Paket Fiktif", komponen: [
  { item_id: material, name: "Bahan Isi", item_type: "Persediaan", base_unit: "pcs", qty: 2, unit: "pcs", factor: 1 },
  { item_id: service, name: "Jasa Isi", item_type: "Jasa", base_unit: "x", qty: 1, unit: "x", factor: 1 },
] };
const packages: PackageOption[] = [{ id: group, name: recipe.name, componentIds: [material, service], perPaket: { [material]: 2, [service]: 1 }, resep: recipe }];
const masterObat = [{ id: group, name: recipe.name, code: "PK", unit: "paket", harga: 50000, paket: true }, { id: material, name: "Bahan Isi", code: "BH", unit: "pcs", harga: 5000 }];
const masterJasa = [{ id: service, name: "Jasa Isi", code: "JS", unit: "x", harga: 40000 }];
const patient = { photo: null, name: "Pasien Fiktif", species: "Kucing", owner: "Pemilik Fiktif", phone: "", address: "", dokter: "drh. Fiktif", jenisLayanan: "Rawat Inap", noInvoice: "(baru)", tanggal: "01/11/2026" };
const data: InpatientCashierData = { tax_settings: { mode_pkp: false, ppn_rate: 0 }, snapshot: "snap", rows: [], history: [], receipts: [], applications: [], quote: { token: "q", remaining: 0, pending: 0, debt: 0, credit: 0, subtotal: 0, tax: 0, amount: 0, excess: 0, accounts: [] } };
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(rows: InpatientCashierRow[], more: Record<string, unknown> = {}) {
  const extra = { serviceStaff: staff, visitDoctorId: doctor, packages, ...more } as Record<string, unknown>;
  await act(async () => root.render(<InpatientCashier {...extra} data={{ ...data, rows }} patient={patient} visitId="visit" recordId="stay" requestKey="key" masterObat={masterObat} masterJasa={masterJasa} ppnRate={0} minDpPercent={50} bolehTerobos={false} />));
}
type Out = (InpatientCashierRow & { service_performers?: { doctor_id: string | null; staff_id: string | null } | null })[];
const payload = (): Out => JSON.parse(host.querySelector<HTMLInputElement>('input[name="pending_rows"]')!.value);
const selectValue = async (el: HTMLSelectElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
const selects = () => [...host.querySelectorAll<HTMLSelectElement>("select")];
const withOption = (name: string) => selects().filter(el => [...el.options].some(o => o.textContent === name));
const stored = { doctor_id: doctor, doctor_name: "drh. Fiktif", staff_id: null, staff_name: null };
const medicine = (over: Partial<InpatientCashierRow> = {}): InpatientCashierRow => ({ id: "old-1", item_id: material, nama_obat: "Bahan Isi", qty: 1, harga: 5000, satuan: "pcs", jenis: "obat", service_performers: stored, ...over });

it("baris pending dengan dokter tersimpan punya pemilih; mengganti dokter masuk payload untuk id baris itu saja", async () => {
  await render([medicine(), medicine({ id: "old-2", nama_obat: "Obat Lain" })]);
  // 2 baris + 1 pengisi massal di bawah tabel; pemilih baris selalu lebih dulu di DOM.
  expect(withOption("drh. Kedua Fiktif").length, "pemilih Dokter harus ada untuk setiap baris pending").toBeGreaterThanOrEqual(2);
  await selectValue(withOption("drh. Kedua Fiktif")[0], doctor2);
  const rows = payload();
  expect(rows[0].service_performers).toMatchObject({ doctor_id: doctor2, staff_id: null });
  expect(rows[1].service_performers).toEqual(stored);
  expect(rows[0].id).toBe("old-1");
});

it("baris pending dengan snapshot kosong (Obat Khusus tanpa pelaksana) dapat diisi Dokter dan Non-dokter", async () => {
  await render([medicine({ service_performers: { doctor_id: null, doctor_name: null, staff_id: null, staff_name: null } })]);
  await selectValue(withOption("drh. Fiktif")[0], doctor);
  await selectValue(withOption("Pendamping Fiktif")[0], nurse);
  expect(payload()[0].service_performers).toMatchObject({ doctor_id: doctor, staff_id: nurse });
});

it("tanpa menyentuh pemilih, pelaksana tersimpan ikut apa adanya (database membaca sebagai tidak berubah)", async () => {
  await render([medicine()]);
  expect(payload()[0].service_performers).toEqual(stored);
});

it("racikan tetap terkunci: tanpa pemilih, pelaksana lama ikut apa adanya", async () => {
  await render([medicine({ id: "racik-1", item_id: null, nama_obat: "Racikan Fiktif", satuan: "racikan", compound_recipe_id: "recipe-1" })]);
  expect(selects().length).toBe(0);
  expect(payload()[0].service_performers).toEqual(stored);
});

it("isi Grup pending: mengganti dokter pada kartu paket menyamakan semua baris isinya", async () => {
  await render([
    medicine({ id: "pk-1", package_item_id: group, package_qty: 1, qty: 2 }),
    medicine({ id: "pk-2", item_id: service, nama_obat: "Jasa Isi", qty: 1, harga: 40000, satuan: "x", jenis: "jasa", package_item_id: group, package_qty: 1 }),
  ]);
  const picker = withOption("drh. Kedua Fiktif");
  expect(picker.length, "kartu paket pending harus punya pemilih pelaksana").toBeGreaterThan(0);
  await selectValue(picker[0], doctor2);
  expect(payload().map(row => row.service_performers?.doctor_id)).toEqual([doctor2, doctor2]);
});

it("peran tanpa hak mengganti pelaksana (DOKTER): baris pending tetap tersegel tanpa pemilih; payload apa adanya", async () => {
  await render([medicine()], { canChangePerformers: false });
  expect(selects().length).toBe(0);
  expect(payload()[0].service_performers).toEqual(stored);
});
