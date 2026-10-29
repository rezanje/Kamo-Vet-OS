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
import { simpanRekamMedis } from "@/app/(app)/klinik/rekam-medis/[visitId]/actions";
import { CatatanForm } from "@/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm";
import { addDailyLogPos } from "@/app/(app)/klinik/rawat-inap/actions";
import type { KatalogRacikan } from "@/lib/katalog-racikan";

// Satu form "Tindakan & Racikan": satu pemilih item, satu daftar Bahan / BMHP, satu tombol simpan.
// Bentuk baris keranjang yang dikirim ke server harus tetap sama dengan dua alur lama.
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const base = { unit: "pcs", stok: 5, sell_price: 10000, code: null as string | null, upc: null as string | null };
const steril = { ...base, id: "steril", name: "Steril", sell_price: 75000, item_type: "Jasa", tindakan_kategori: "Operasi" };
const gauze = { ...base, id: "gauze", name: "Kasa steril", unit: "lembar", stok: 9, sell_price: 1000, item_type: "Persediaan" };
const compound = { ...base, id: "compound", name: "Obat Racik Sirup", unit: "PCS", stok: 0, sell_price: 25000, item_type: "Persediaan" };
const ingredient = { ...base, id: "ingredient", name: "Bahan diizinkan", sell_price: 5000, item_type: "Persediaan" };
const formula: KatalogRacikan = {
  id: "formula", code: "RCP-1", active: true, sale_item_id: "compound", version_id: "v1", version: 1,
  name: "Puyer Batuk", dosage_form: "puyer", dosage_instruction: "3x sehari 1 bungkus",
  ingredients: [{ item_id: "ingredient", name: "Bahan diizinkan", quantity: 2, unit: "pcs", unit_price: 5000 }],
};
const common = {
  requestKey: "request", draftUserId: "owner", items: [gauze], jasaItems: [{ ...base, id: "consult", name: "Konsultasi", item_type: "Jasa" }],
  tindakanItems: [steril], bahanItems: [ingredient], racikanItems: [compound], katalogRacikan: [formula], bolehManual: true,
};
const patient = { name: "Milo", species: "Kucing", breed: null, noRM: "RM1", owner: "Pemilik", phone: "08123", address: "", photo: null, dokter: "Dokter" };
const TINDAKAN = "Tindakan & Racikan";

async function render(kind: string) {
  await act(async () => root.render(kind === "exam"
    ? <RekamForm {...common} visitId="visit" petId="pet" currentWeight={null} dokterOpsi={[]} providerOpsi={[]}
      patient={{ ...patient, tglPeriksa: "29 Oct", dokterId: null, providerId: null, tier: "Umum", keluhan: "Kontrol" }} />
    : <CatatanForm {...common} recordId="inpatient" backHref="/klinik/rawat-inap/inpatient"
      patient={{ ...patient, tglMasuk: "29 Oct", kondisi: "Stabil" }} />));
}
async function openTab() {
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === TINDAKAN)!.click());
}
const click = (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
const cart = () => JSON.parse(host.querySelector<HTMLInputElement>('input[name="resep"]')!.value);
const field = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
async function type(label: string, value: string) {
  const control = field(label)!;
  expect(control, label).not.toBeNull();
  const proto = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
/** Pemilih bahan/BMHP/resep resmi: ketik lalu pilih hasil pertama. */
async function pickFrom(label: string, query: string) {
  const picker = field(label)!;
  expect(picker, label).not.toBeNull();
  await act(async () => {
    picker.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(picker, query);
    picker.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => picker.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  await act(async () => picker.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
}
const cell = (name: string) => [...host.querySelectorAll("td")].find(td => td.querySelector("[data-cart-item]")?.textContent === name);

it.each(["exam", "inpatient"])("%s shows one picker listing procedures and compounds side by side", async kind => {
  await render(kind); await openTab();
  const picker = host.querySelector('section[aria-label="Pilih tindakan / racikan"]')!;
  expect(picker.textContent).toContain("Steril");
  expect(picker.textContent).toContain("Obat Racik Sirup");
  expect(picker.querySelector('button[aria-label="Pilih Steril"]')).not.toBeNull();
  expect(picker.querySelector('button[aria-label="Pilih Obat Racik Sirup"]')).not.toBeNull();
  // Satu kolom pencarian, bukan satu untuk tindakan dan satu untuk racikan.
  expect(host.querySelectorAll('input[aria-label="Cari tindakan / racikan"]')).toHaveLength(1);
  expect(field("Cari obat racik")).toBeNull();
});

it.each(["exam", "inpatient"])("%s picked procedure shows only the materials list, without compound fields", async kind => {
  await render(kind); await openTab();
  await click('button[aria-label="Pilih Steril"]');
  expect(host.textContent).toContain("Bahan / BMHP · Steril");
  expect(field("Tambah BMHP Steril")).not.toBeNull();
  expect(field("Bentuk racikan")).toBeNull();
  expect(field("Aturan pakai racikan")).toBeNull();
  expect(host.textContent).not.toContain("Komposisi racikan");
});

it.each(["exam", "inpatient"])("%s picked compound keeps the same materials list and adds dosage form and instruction", async kind => {
  await render(kind); await openTab();
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  expect(host.textContent).toContain("Bahan / BMHP · Obat Racik Sirup");
  expect(field("Tambah bahan Obat Racik Sirup")).not.toBeNull();
  expect(field("Bentuk racikan")).not.toBeNull();
  expect(field("Aturan pakai racikan")).not.toBeNull();
  expect(host.textContent).toContain("Komposisi racikan");
});

it.each(["exam", "inpatient"])("%s official formula prefills the materials list and keeps the recorded compound payload", async kind => {
  await render(kind); await openTab();
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  await pickFrom("Komposisi racikan", "Puyer");
  expect(host.textContent).toContain("Bahan diizinkan × 2 pcs");
  expect(field("Bentuk racikan")!.value).toBe("puyer");
  expect(field("Aturan pakai racikan")!.value).toBe("3x sehari 1 bungkus");
  await click('button[aria-label="Tambah Obat Racik Sirup ke keranjang"]');
  expect(cart()).toEqual([{
    key: expect.any(String), item_id: null, sale_item_id: "compound", nama_obat: "Obat Racik Sirup",
    qty: 1, satuan: "racikan", faktor: 1, harga: 25000, jenis: "racikan", official_version_id: "v1",
    ingredients: [{ item_id: "ingredient", nama: "Bahan diizinkan", qty: 2, satuan: "pcs", harga: 5000 }],
    dosage_form: "puyer", aturan_pakai: "3x sehari 1 bungkus",
    service_performers: { doctor_id: null, staff_id: null },
  }]);
});

it.each(["exam", "inpatient"])("%s commits a procedure and a patient compound with the payload shape of the old flows", async kind => {
  await render(kind); await openTab();
  await click('button[aria-label="Pilih Steril"]');
  await pickFrom("Tambah BMHP Steril", "Kasa");
  await type("Jumlah BMHP Kasa steril", "2");
  await click('button[aria-label="Tambah Steril ke keranjang"]');
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  await pickFrom("Tambah bahan Obat Racik Sirup", "Bahan");
  await type("Jumlah bahan Bahan diizinkan", "3");
  await type("Bentuk racikan", "kapsul");
  await type("Aturan pakai racikan", "2x sehari");
  await click('button[aria-label="Tambah Obat Racik Sirup ke keranjang"]');
  expect(cart()).toEqual([
    { key: expect.any(String), item_id: "steril", nama_obat: "Steril", qty: 1, satuan: "pcs", harga: 75000, faktor: 1,
      jenis: "jasa", kategori: "Operasi", service_performers: { doctor_id: null, staff_id: null },
      bmhp: [{ item_id: "gauze", nama: "Kasa steril", qty: 2, unit: "lembar" }] },
    { key: expect.any(String), item_id: null, sale_item_id: "compound", nama_obat: "Obat Racik Sirup",
      qty: 1, satuan: "racikan", faktor: 1, harga: 25000, jenis: "racikan",
      ingredients: [{ item_id: "ingredient", nama: "Bahan diizinkan", qty: 3, satuan: "pcs", harga: 5000 }],
      dosage_form: "kapsul", aturan_pakai: "2x sehari", service_performers: { doctor_id: null, staff_id: null } },
  ]);
  // Racikan khusus pasien tidak membawa versi resep resmi.
  expect(cart()[1]).not.toHaveProperty("official_version_id");
});

it.each(["exam", "inpatient"])("%s reopens a compound cart line prefilled and saves it in place", async kind => {
  await render(kind); await openTab();
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  await pickFrom("Tambah bahan Obat Racik Sirup", "Bahan");
  await type("Jumlah bahan Bahan diizinkan", "2");
  await type("Aturan pakai racikan", "3x sehari");
  await click('button[aria-label="Tambah Obat Racik Sirup ke keranjang"]');
  const key = cart()[0].key;
  await click('button[aria-label="Ubah bahan Obat Racik Sirup"]');
  expect(field("Jumlah bahan Bahan diizinkan")!.value).toBe("2");
  expect(field("Aturan pakai racikan")!.value).toBe("3x sehari");
  await type("Jumlah bahan Bahan diizinkan", "4");
  await click('button[aria-label="Simpan Obat Racik Sirup"]');
  // Baris yang sama diperbarui — tidak ada baris racikan kembar.
  expect(cart()).toHaveLength(1);
  expect(cart()[0]).toMatchObject({ key, jenis: "racikan", aturan_pakai: "3x sehari",
    ingredients: [{ item_id: "ingredient", qty: 4, satuan: "pcs", harga: 5000 }] });
});

it.each(["exam", "inpatient"])("%s reopens a procedure cart line prefilled from the same form", async kind => {
  await render(kind); await openTab();
  await click('button[aria-label="Pilih Steril"]');
  await pickFrom("Tambah BMHP Steril", "Kasa");
  await click('button[aria-label="Tambah Steril ke keranjang"]');
  await click('button[aria-label="Ubah BMHP Steril"]');
  expect(field("Jumlah BMHP Kasa steril")!.value).toBe("1");
  await type("Jumlah BMHP Kasa steril", "5");
  await click('button[aria-label="Simpan Steril"]');
  expect(cart()).toHaveLength(1);
  expect(cart()[0].bmhp).toEqual([{ item_id: "gauze", nama: "Kasa steril", qty: 5, unit: "lembar" }]);
});

it.each(["exam", "inpatient"])("%s routes an already compounded line to the racik correction instead of reissuing stock", async kind => {
  await render(kind); await openTab();
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  await pickFrom("Komposisi racikan", "Puyer");
  await click('button[aria-label="Tambah Obat Racik Sirup ke keranjang"]');
  const name = Object.keys(sessionStorage).find(key => key.includes("clinic-draft"))!;
  const saved = JSON.parse(sessionStorage.getItem(name)!);
  saved.snapshot.cart[0].compound_recipe_id = "recipe-1";
  sessionStorage.setItem(name, JSON.stringify(saved));
  await act(async () => root.unmount()); root = createRoot(host); await render(kind);
  expect(host.querySelector('button[aria-label="Ubah bahan Obat Racik Sirup"]')).toBeNull();
  expect(host.textContent).toContain("Sudah diracik");
  expect(host.querySelector('a[href="/klinik/racik/recipe-1"]')).not.toBeNull();
});

it.each(["exam", "inpatient"])("%s cart line keeps the item name bold with its materials block underneath", async kind => {
  await render(kind); await openTab();
  await click('button[aria-label="Pilih Steril"]');
  await pickFrom("Tambah BMHP Steril", "Kasa");
  await click('button[aria-label="Tambah Steril ke keranjang"]');
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  await pickFrom("Komposisi racikan", "Puyer");
  await click('button[aria-label="Tambah Obat Racik Sirup ke keranjang"]');

  const procedure = cell("Steril")!;
  const nama = procedure.querySelector<HTMLElement>("[data-cart-item]")!;
  expect(nama.tagName).toBe("STRONG");
  expect(nama.style.fontWeight).toBe("700");
  const bmhp = procedure.querySelector<HTMLElement>('[data-bahan-blok="bmhp"]')!;
  expect(bmhp).not.toBeNull();
  expect(bmhp.textContent).toContain("BMHP");
  expect(bmhp.textContent).toContain("Kasa steril × 1 lembar");
  expect(bmhp.querySelector('button[aria-label="Ubah BMHP Steril"]')).not.toBeNull();
  // Pilihan pelaksana tetap ada (payload tidak berubah) dan tetap di dalam baris yang sama.
  expect(procedure.querySelectorAll("fieldset select")).toHaveLength(2);

  const racikan = cell("Obat Racik Sirup")!;
  const bahan = racikan.querySelector<HTMLElement>('[data-bahan-blok="racikan"]')!;
  expect(bahan.textContent).toContain("Bahan racikan");
  expect(bahan.textContent).toContain("Bahan diizinkan × 2 pcs");
});

it.each(["exam", "inpatient"])("%s blocks saving while the single form still has an uncommitted item", async kind => {
  vi.clearAllMocks();
  await render(kind); await openTab();
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  await pickFrom("Komposisi racikan", "Puyer");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(kind === "exam" ? simpanRekamMedis : addDailyLogPos).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Selesaikan form tindakan / racikan");
  // Batal mengosongkan form sehingga penyimpanan bisa dilanjutkan.
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === "Batal")!.click());
  expect(host.querySelector('button[aria-label="Tambah Obat Racik Sirup ke keranjang"]')).toBeNull();
  expect(cart()).toEqual([]);
});
