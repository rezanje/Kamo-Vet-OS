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

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const base = { unit: "pcs", stok: 5, sell_price: 10000 };
const service = { ...base, id: "consult", name: "Konsultasi", item_type: "Jasa" };
const action = { ...base, id: "steril", name: "Steril", sell_price: 75000, item_type: "Jasa", tindakan_kategori: "Operasi" };
const vaccine = { ...base, id: "vaccine", name: "Vaksin", sell_price: 35000, item_type: "Jasa", tindakan_kategori: "Vaksinasi" };
const food = { ...base, id: "food", name: "Makanan kucing", item_type: "Persediaan", units: [{ unit: "pcs", factor: 1, sell_price: 10000, buy_price: 5000 }] };
const common = {
  requestKey: "request", draftUserId: "owner", items: [vaccine, food], jasaItems: [service], tindakanItems: [action],
  bahanItems: [{ ...base, id: "ingredient", name: "Bahan diizinkan" }],
  racikanItems: [{ ...base, id: "compound", name: "Obat Racik Sirup" }], katalogRacikan: [], bolehManual: true,
};
const patient = { name: "Milo", species: "Kucing", breed: null, noRM: "RM1", owner: "Pemilik", phone: "08123", address: "", photo: null, dokter: "Dokter" };
async function render(kind: string) {
  await act(async () => root.render(kind === "exam"
    ? <RekamForm {...common} visitId="visit" petId="pet" currentWeight={null} dokterOpsi={[]} providerOpsi={[]}
      patient={{ ...patient, tglPeriksa: "13 Oct", dokterId: null, providerId: null, tier: "Umum", keluhan: "Kontrol" }} />
    : <CatatanForm {...common} recordId="inpatient" backHref="/klinik/rawat-inap/inpatient"
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
const cart = () => JSON.parse(host.querySelector<HTMLInputElement>('input[name="resep"]')!.value);

it.each(["exam", "inpatient"])("%s picks catalog actions and restores unchanged item IDs, prices and consent categories", async kind => {
  await render(kind);
  expect([...host.querySelectorAll("button")].some(button => button.textContent?.trim() === "Paket")).toBe(false);
  await tab("Tindakan");
  expect(host.textContent).toContain("Steril"); expect(host.textContent).not.toContain("Konsultasi");
  await search("Cari tindakan", "Konsultasi");
  expect(host.textContent).not.toContain("Steril");
  await search("Cari tindakan", "Steril");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Tambah Steril"]')!.click());
  expect(cart()).toEqual([expect.objectContaining({ item_id: "steril", harga: 75000, qty: 1, jenis: "jasa", kategori: "Operasi" })]);
  await tab("Jasa");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Tambah Konsultasi"]')!.click());
  const expected = cart();
  await act(async () => root.unmount()); root = createRoot(host); await render(kind);
  expect(cart()).toEqual(expected);
});

it.each(["exam", "inpatient"])("%s keeps non-Jasa/non-Tindakan services selectable in Obat with their existing transaction kind", async kind => {
  await render(kind);
  const row = [...host.querySelectorAll("tr")].find(row => row.textContent?.includes("Vaksin"))!;
  await act(async () => row.querySelector<HTMLButtonElement>("button")!.click());
  expect(cart()).toEqual([expect.objectContaining({ item_id: "vaccine", nama_obat: "Vaksin", harga: 35000, jenis: "jasa", kategori: "Vaksinasi" })]);
});

it.each(["exam", "inpatient"])("%s searches only finished compounds and designated ingredients in Racikan", async kind => {
  await render(kind); await tab("Racikan");
  await search("Cari obat racik", "Obat");
  expect(host.querySelector('button[aria-label="Pilih Obat Racik Sirup"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="Pilih Vaksin"]')).toBeNull();
  await search("Cari bahan racikan", "Bahan");
  expect(host.querySelector('button[aria-label="Pilih bahan Bahan diizinkan"]')).not.toBeNull();
  await search("Cari bahan racikan", "Makanan");
  expect(host.querySelector('button[aria-label="Pilih bahan Makanan kucing"]')).toBeNull();
});

it('places optional therapy below diagnosis and restores the note without adding billable items',async()=>{
  await render('exam');
  const note=host.querySelector<HTMLTextAreaElement>('textarea[name="therapy"]');expect(note).not.toBeNull();expect(note!.required).toBe(false);
  const fields=[...host.querySelectorAll('textarea')];expect(fields.indexOf(note!)).toBe(fields.findIndex(field=>field.name==='diagnosis')+1);
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(note,'Terapi fiktif\nObservasi');note!.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>root.unmount());root=createRoot(host);await render('exam');
  expect(host.querySelector<HTMLTextAreaElement>('[name=therapy]')!.value).toBe('Terapi fiktif\nObservasi');expect(cart()).toEqual([]);
});
