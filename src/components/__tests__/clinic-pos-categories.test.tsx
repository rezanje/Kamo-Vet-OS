// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/actions", () => ({ simpanRekamMedis: vi.fn() }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ addDailyLogPos: vi.fn() }));
vi.mock("@/components/PetPhotoUpload", () => ({ PetPhotoUpload: () => null }));
vi.mock("@/components/PenunjangUpload", () => ({ PenunjangUpload: () => null }));
import { RekamForm } from "@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm";
import { CatatanForm } from "@/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm";
import { splitClinicItems } from "@/lib/clinic-item-categories";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const base = { unit: "pcs", stok: 5, sell_price: 10000, category_id: null as string | null, is_compound_material: false,
  code: null as string | null, upc: null as string | null };
const service = { ...base, id: "consult", name: "Konsultasi", item_type: "Jasa" };
const action = { ...base, id: "steril", name: "Steril", sell_price: 75000, item_type: "Jasa", category_id: "actions", tindakan_kategori: "Operasi" };
const vaccine = { ...base, id: "vaccine", name: "Vaksin", sell_price: 35000, item_type: "Jasa", category_id: "medicine", tindakan_kategori: "Vaksinasi" };
const food = { ...base, id: "food", name: "Makanan kucing", item_type: "Persediaan", units: [{ unit: "pcs", factor: 1, sell_price: 10000, buy_price: 5000 }] };
const ingredient = { ...base, id: "ingredient", name: "Bahan diizinkan", item_type: "Persediaan", is_compound_material: true };
const compound = { ...base, id: "compound", name: "Obat Racik Sirup", item_type: "Persediaan", category_id: "actions" };
const categories = [{ id: "actions", name: "TINDAKAN" }, { id: "medicine", name: "OBAT" }];
const groups = splitClinicItems([vaccine, food, service, action, ingredient, compound], categories, new Set([compound.id]));
const common = {
  requestKey: "request", draftUserId: "owner", items: groups.obat, jasaItems: groups.jasa, tindakanItems: groups.tindakan,
  bahanItems: groups.bahan, racikanItems: groups.racikan, katalogRacikan: [], bolehManual: true,
};
const patient = { name: "Milo", species: "Kucing", breed: null, noRM: "RM1", owner: "Pemilik", phone: "08123", address: "", photo: null, dokter: "Dokter" };
async function render(kind: string, medicines = common.items) {
  await act(async () => root.render(kind === "exam"
    ? <RekamForm {...common} items={medicines} visitId="visit" petId="pet" currentWeight={null} dokterOpsi={[]} providerOpsi={[]}
      patient={{ ...patient, tglPeriksa: "13 Oct", dokterId: null, providerId: null, tier: "Umum", keluhan: "Kontrol" }} />
    : <CatatanForm {...common} items={medicines} recordId="inpatient" backHref="/klinik/rawat-inap/inpatient"
      patient={{ ...patient, tglMasuk: "13 Oct", kondisi: "Stabil" }} />));
}
async function tab(name: string) {
  const button = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === name);
  expect(button, `tab ${name}`).toBeDefined();
  await act(async () => button!.click());
}
async function search(label: string, value: string) {
  const control = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(control).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** Daftar bahan/BMHP memakai pemilih berportal: isi kata kunci lalu baca pilihannya. */
async function bukaPemilih(label: string, query: string) {
  const picker = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(picker, label).not.toBeNull();
  await act(async () => {
    picker.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(picker, query);
    picker.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return picker;
}
const opsiBahan = async (label: string, query: string) => {
  await bukaPemilih(label, query);
  return [...document.querySelectorAll('[role="option"]')].map(option => option.textContent ?? "");
};
async function pilihBahan(label: string, query: string) {
  const picker = await bukaPemilih(label, query);
  await act(async () => picker.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  await act(async () => picker.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
}
const cart = () => JSON.parse(host.querySelector<HTMLInputElement>('input[name="resep"]')!.value);
// Tindakan dan racikan kini digabung pada satu tab.
const TINDAKAN = "Tindakan & Racikan";

it.each(["exam", "inpatient"])("%s picks catalog actions and restores unchanged item IDs, prices and consent categories", async kind => {
  await render(kind);
  expect([...host.querySelectorAll("button")].some(button => button.textContent?.trim() === "Paket")).toBe(false);
  await tab(TINDAKAN);
  expect(host.textContent).toContain("Steril"); expect(host.textContent).not.toContain("Konsultasi");
  await search("Cari tindakan / racikan", "Konsultasi");
  expect(host.textContent).not.toContain("Steril");
  await search("Cari tindakan / racikan", "Steril");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Pilih Steril"]')!.click());
  expect(cart()).toEqual([]);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Tambah Steril ke keranjang"]')!.click());
  expect(cart()).toEqual([expect.objectContaining({ item_id: "steril", harga: 75000, qty: 1, jenis: "jasa", kategori: "Operasi" })]);
  await tab("Jasa");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Tambah Konsultasi"]')!.click());
  const expected = cart();
  await act(async () => root.unmount()); root = createRoot(host); await render(kind);
  expect(cart()).toEqual(expected);
});

it.each(["exam", "inpatient"])("%s keeps a service under an Obat category in Jasa with its existing transaction kind", async kind => {
  await render(kind);
  expect([...host.querySelectorAll("tbody tr")].some(row => row.textContent?.includes("Vaksin"))).toBe(false);
  await tab("Jasa");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Tambah Vaksin"]')!.click());
  expect(cart()).toEqual([expect.objectContaining({ item_id: "vaccine", nama_obat: "Vaksin", harga: 35000, jenis: "jasa", kategori: "Vaksinasi" })]);
});

it.each(["exam", "inpatient"])("%s searches the whole inventory before pagination and resets the page for an ingredient medicine", async kind => {
  const medicines = Array.from({ length: 81 }, (_, i) => ({ ...food, id: `stock-${i}`, name: `Stock ${i}` }));
  const anthel = { ...food, id: "anthel", name: "Anthel fixture", stok: 50, is_compound_material: true };
  const inventory = splitClinicItems([...medicines, anthel, service, action, compound], categories, new Set([compound.id])).obat;
  await render(kind, inventory);
  const next = () => host.querySelector<HTMLButtonElement>('button[aria-label="Obat berikutnya"]')!;
  await act(async () => next().click());
  expect(host.textContent).toContain("82 obat · 2/3");
  const control = () => host.querySelector<HTMLInputElement>('input[placeholder="Cari nama obat / scan barcode…"]')!;
  const change = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control(), value);
    control().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await change("AnTh");
  expect(host.textContent).toContain("Anthel fixture");
  expect(host.textContent).toContain("1 obat · 1/1");
  expect(next().disabled).toBe(true);
  const row = [...host.querySelectorAll("tr")].find(row => row.textContent?.includes("Anthel fixture"))!;
  await act(async () => row.querySelector<HTMLButtonElement>("button")!.click());
  expect(cart()).toEqual([expect.objectContaining({ item_id: "anthel", harga: 10000, qty: 1, jenis: "obat" })]);
  await change("no-match");
  expect(host.textContent).toContain("Tidak ada obat.");
  await change("");
  expect(host.textContent).toContain("82 obat · 1/3");
  await act(async () => next().click());
  await act(async () => next().click());
  expect(host.textContent).toContain("82 obat · 3/3");
  const medicineTable = [...host.querySelectorAll("table")].find(table => table.querySelector("th")?.textContent === "Nama Obat")!;
  expect(medicineTable.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(medicineTable.textContent).toContain("Stock 80");
  expect(medicineTable.textContent).toContain("Anthel fixture");
});

it.each(["exam", "inpatient"])("%s finds an inventory medicine by master code or scanned UPC", async kind => {
  await render(kind, [{ ...food, code: "OBT-42", upc: "8900012345678" }]);
  const control = host.querySelector<HTMLInputElement>('input[placeholder="Cari nama obat / scan barcode…"]')!;
  const change = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await change("OBT-42");
  expect(host.textContent).toContain("Makanan kucing");
  await change("8900012345678");
  expect(host.textContent).toContain("Makanan kucing");
  expect(host.textContent).toContain("1 obat · 1/1");
});

it.each(["exam", "inpatient"])("%s offers procedures and finished compounds in one picker, with designated ingredients only", async kind => {
  await render(kind); await tab(TINDAKAN);
  // Satu pemilih: tindakan dan obat racik dicari di kolom yang sama.
  await search("Cari tindakan / racikan", "Obat");
  expect(host.querySelector('button[aria-label="Pilih Obat Racik Sirup"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="Pilih Vaksin"]')).toBeNull();
  await search("Cari tindakan / racikan", "Steril");
  expect(host.querySelector('button[aria-label="Pilih Steril"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Pilih Steril"]')!.click());
  // Tindakan: daftar bahan diisi dari BMHP, bukan dari bahan racikan.
  expect(await opsiBahan("Tambah BMHP Steril", "Makanan")).toEqual(["Makanan kucing (stok 5 pcs)"]);
  await search("Cari tindakan / racikan", "Obat Racik");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Pilih Obat Racik Sirup"]')!.click());
  expect(await opsiBahan("Tambah bahan Obat Racik Sirup", "Bahan")).toEqual(["Bahan diizinkan (stok 5 pcs)"]);
  expect(await opsiBahan("Tambah bahan Obat Racik Sirup", "Makanan")).toEqual([]);
});

it.each(["exam", "inpatient"])("%s retains a doctor-selected patient composition for a finished compound after draft reload", async kind => {
  await render(kind); await tab(TINDAKAN);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Pilih Obat Racik Sirup"]')!.click());
  await pilihBahan("Tambah bahan Obat Racik Sirup", "Bahan");
  const quantity = host.querySelector<HTMLInputElement>('input[aria-label="Jumlah bahan Bahan diizinkan"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(quantity, "2");
    quantity.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const add = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Tambah ke keranjang")!;
  await act(async () => add.click());
  const expected = [expect.objectContaining({ sale_item_id: "compound", item_id: null, jenis: "racikan",
    ingredients: [expect.objectContaining({ item_id: "ingredient", qty: 2 })] })];
  expect(cart()).toEqual(expected);
  expect(cart()[0]).not.toHaveProperty("official_version_id");
  await act(async () => root.unmount()); root = createRoot(host); await render(kind);
  expect(cart()).toEqual(expected);
  expect(cart()[0]).not.toHaveProperty("official_version_id");
});

it('places optional therapy below diagnosis and restores the note without adding billable items',async()=>{
  await render('exam');
  const note=host.querySelector<HTMLTextAreaElement>('textarea[name="therapy"]');expect(note).not.toBeNull();expect(note!.required).toBe(false);
  const fields=[...host.querySelectorAll('textarea')];expect(fields.indexOf(note!)).toBe(fields.findIndex(field=>field.name==='diagnosis')+1);
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(note,'Terapi fiktif\nObservasi');note!.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>root.unmount());root=createRoot(host);await render('exam');
  expect(host.querySelector<HTMLTextAreaElement>('[name=therapy]')!.value).toBe('Terapi fiktif\nObservasi');expect(cart()).toEqual([]);
});
