// @vitest-environment jsdom
import { act } from "react";
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

// Synthetic master shaped like production: every service carries tindakan_kategori "Konsultasi";
// only the category tree tells a clinic procedure (TINDAKAN) apart from grooming or delivery services.
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const base = { unit: "pcs", stok: 5, sell_price: 10000, is_compound_material: false, code: null as string | null, upc: null as string | null };
const categories = [
  { id: "tindakan", name: "TINDAKAN" }, { id: "bedah", name: "Bedah", parent_id: "tindakan" },
  { id: "grooming", name: "GROOMING" }, { id: "delivery", name: "DELIVERY" },
];
const procedure = { ...base, id: "steril", name: "Sintetis Steril", sell_price: 75000, item_type: "Jasa", category_id: "bedah", tindakan_kategori: "Konsultasi" };
const grooming = { ...base, id: "groom", name: "Sintetis Grooming", item_type: "Jasa", category_id: "grooming", tindakan_kategori: "Konsultasi" };
const pickup = { ...base, id: "pickup", name: "Sintetis Antar Jemput", item_type: "Jasa", category_id: "delivery", tindakan_kategori: "Konsultasi" };
const vaccine = { ...base, id: "vaksin", name: "Sintetis Vaksin Stok", sell_price: 235000, item_type: "Persediaan", category_id: "bedah", tindakan_kategori: null, unit: "VIAL",
  units: [{ unit: "VIAL", factor: 1, sell_price: 235000, buy_price: 150000 }] };
const gauze = { ...base, id: "gauze", name: "Kasa sintetis", item_type: "Persediaan", category_id: null, unit: "lembar",
  units: [{ unit: "lembar", factor: 1, sell_price: 1000, buy_price: 500 }, { unit: "pak", factor: 10, sell_price: 9000, buy_price: 5000 }] };
// Vaccination service coded "JV-<vial code>", with the vial itself kept as stock in the medicine list.
const vial = { ...base, id: "vial", code: "VKS-1", name: "Vaccine Sintetis", sell_price: 235000, item_type: "Persediaan", category_id: null, unit: "VIAL" };
const vaccination = { ...base, id: "vaksinasi", code: "JV-VKS-1", name: "Vaksinasi Sintetis", sell_price: 235000, item_type: "Jasa", category_id: "bedah", tindakan_kategori: "Konsultasi", unit: "PCS" };
// A vial left (or moved back) under TINDAKAN still opens its vaccination instead of joining as stock.
const strayVial = { ...vial, id: "vial2", code: "VKS-2", name: "Vaccine Nyasar", category_id: "bedah" };
const strayVaccination = { ...vaccination, id: "vaksinasi2", code: "JV-VKS-2", name: "Vaksinasi Nyasar" };
const groups = splitClinicItems([procedure, vaccine, vaccination, strayVial, strayVaccination, grooming, pickup, gauze, vial], categories, new Set());
const common = {
  requestKey: "request", draftUserId: "owner", items: groups.obat, jasaItems: groups.jasa, tindakanItems: groups.tindakan,
  bahanItems: groups.bahan, racikanItems: groups.racikan, katalogRacikan: [], bolehManual: true,
};
const patient = { name: "Hewan Uji", species: "Kucing", breed: null, noRM: "RM-UJI", owner: "Pemilik Uji", phone: "0800", address: "", photo: null, dokter: "Dokter" };
async function render(kind: string) {
  await act(async () => root.render(kind === "exam"
    ? <RekamForm {...common} visitId="visit" petId="pet" currentWeight={null} dokterOpsi={[]} providerOpsi={[]}
      patient={{ ...patient, tglPeriksa: "27 Oct", dokterId: null, providerId: null, tier: "Umum", keluhan: "Kontrol" }} />
    : <CatatanForm {...common} recordId="inpatient" backHref="/klinik/rawat-inap/inpatient"
      patient={{ ...patient, tglMasuk: "27 Oct", kondisi: "Stabil" }} />));
}
async function tab(name: string) {
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === name)!.click());
}
const click = (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
const cart = () => JSON.parse(host.querySelector<HTMLInputElement>('input[name="resep"]')!.value);
const bmhpEditors = () => host.querySelectorAll('input[aria-label^="Tambah BMHP"], button[aria-label^="Ubah BMHP"]');

it("classifies by category tree, not by service type or name", () => {
  expect(groups.tindakan.map(item => item.id)).toEqual(["steril", "vaksin", "vaksinasi", "vial2", "vaksinasi2"]);
  expect(groups.jasa.map(item => item.id).sort()).toEqual(["groom", "pickup"]);
});

it.each(["exam", "inpatient"])("%s grooming and pickup services join the cart without any BMHP editor", async kind => {
  await render(kind); await tab("Jasa");
  await click('button[aria-label="Tambah Sintetis Grooming"]');
  await click('button[aria-label="Tambah Sintetis Antar Jemput"]');
  expect(cart().map((row: { item_id: string }) => row.item_id)).toEqual(["groom", "pickup"]);
  expect(cart().every((row: { bmhp?: unknown }) => row.bmhp === undefined)).toBe(true);
  expect(bmhpEditors()).toHaveLength(0);
  expect(host.textContent).not.toContain("Komposisi BMHP tindakan");
  // Grooming performer and per-SKU seller stay available on the service rows.
  expect(host.querySelector('select[aria-label="Penjual Sintetis Grooming"]')).toBeTruthy();
  expect([...host.querySelectorAll("fieldset legend")].some(legend => legend.textContent === "Pelaksana Sintetis Grooming")).toBe(true);
});

it.each(["exam", "inpatient"])("%s procedure composes materials with qty and unit, reopens them, and carries each material once", async kind => {
  await render(kind); await tab("Tindakan");
  await click('button[aria-label="Tambah Sintetis Steril"]');
  expect(host.textContent).toContain("Komposisi BMHP tindakan");
  const picker = host.querySelector<HTMLInputElement>('input[aria-label="Tambah BMHP Sintetis Steril"]')!;
  await act(async () => {
    picker.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(picker, "Kasa");
    picker.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => picker.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  await act(async () => picker.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  const qty = host.querySelector<HTMLInputElement>('input[aria-label="Jumlah BMHP Kasa sintetis"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(qty, "3"); qty.dispatchEvent(new Event("input", { bubbles: true })); });
  await click('button[aria-label="Tambah tindakan Sintetis Steril ke keranjang"]');
  expect(cart()).toHaveLength(1);
  expect(cart()[0]).toMatchObject({ item_id: "steril", jenis: "jasa", harga: 75000, bmhp: [{ item_id: "gauze", qty: 3, unit: "lembar" }] });

  await act(async () => root.unmount()); root = createRoot(host); await render(kind);
  await click('button[aria-label="Ubah BMHP Sintetis Steril"]');
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Jumlah BMHP Kasa sintetis"]')?.value).toBe("3");
  await click('button[aria-label="Simpan BMHP Sintetis Steril"]');
  // The material rides only inside the procedure row: no separate medicine line that would deduct stock twice.
  expect(cart()).toHaveLength(1);
  expect(cart().filter((row: { item_id: string }) => row.item_id === "gauze")).toHaveLength(0);
  expect(cart()[0].bmhp).toEqual([{ item_id: "gauze", nama: "Kasa sintetis", qty: 3, unit: "lembar" }]);
});

it.each(["exam", "inpatient"])("%s keeps BMHP already stored on a service row read-only instead of dropping it", async kind => {
  await render(kind); await tab("Jasa");
  await click('button[aria-label="Tambah Sintetis Grooming"]');
  const key = Object.keys(sessionStorage).find(name => name.includes("clinic-draft"))!;
  const saved = JSON.parse(sessionStorage.getItem(key)!);
  saved.snapshot.cart[0].bmhp = [{ item_id: "gauze", nama: "Kasa sintetis", qty: 2, unit: "lembar" }];
  sessionStorage.setItem(key, JSON.stringify(saved));
  await act(async () => root.unmount()); root = createRoot(host); await render(kind);
  expect(cart()[0].bmhp).toEqual(saved.snapshot.cart[0].bmhp);
  expect(bmhpEditors()).toHaveLength(0);
  expect(host.textContent).toContain("Kasa sintetis × 2 lembar");
});

it.each(["exam", "inpatient"])("%s stocked procedure SKU joins the cart as stock without a BMHP composer that could not be saved", async kind => {
  await render(kind); await tab("Tindakan");
  await click('button[aria-label="Tambah Sintetis Vaksin Stok"]');
  expect(host.textContent).not.toContain("Komposisi BMHP tindakan");
  expect(cart()).toHaveLength(1);
  expect(cart()[0]).toMatchObject({ item_id: "vaksin", jenis: "obat", satuan: "VIAL", harga: 235000 });
  expect(cart()[0]).not.toHaveProperty("bmhp");
  expect(bmhpEditors()).toHaveLength(0);
});

it.each(["exam", "inpatient"])("%s vaccine vial picked from the medicine list opens its vaccination with the vial as BMHP", async kind => {
  await render(kind);
  const row = [...host.querySelectorAll("tr")].find(tr => tr.textContent?.includes("Vaccine Sintetis"))!;
  await act(async () => row.querySelector<HTMLButtonElement>('button[title="Tambah"]')!.click());
  expect(host.textContent).toContain("Komposisi BMHP tindakan");
  expect(cart()).toHaveLength(0);
  await click('button[aria-label="Tambah tindakan Vaksinasi Sintetis ke keranjang"]');
  // One billed line: the vaccination service; the vial rides only as its BMHP.
  expect(cart()).toHaveLength(1);
  expect(cart()[0]).toMatchObject({ item_id: "vaksinasi", jenis: "jasa", harga: 235000, bmhp: [{ item_id: "vial", nama: "Vaccine Sintetis", qty: 1, unit: "VIAL" }] });
});

it.each(["exam", "inpatient"])("%s vaccination picked from the procedure tab starts with its vial as BMHP", async kind => {
  await render(kind); await tab("Tindakan");
  await click('button[aria-label="Tambah Vaksinasi Sintetis"]');
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Jumlah BMHP Vaccine Sintetis"]')?.value).toBe("1");
});

it.each(["exam", "inpatient"])("%s vaccine vial listed under TINDAKAN still opens its vaccination", async kind => {
  await render(kind); await tab("Tindakan");
  await click('button[aria-label="Tambah Vaccine Nyasar"]');
  expect(host.textContent).toContain("Komposisi BMHP tindakan");
  await click('button[aria-label="Tambah tindakan Vaksinasi Nyasar ke keranjang"]');
  expect(cart()).toHaveLength(1);
  expect(cart()[0]).toMatchObject({ item_id: "vaksinasi2", jenis: "jasa", bmhp: [{ item_id: "vial2", qty: 1, unit: "VIAL" }] });
});
