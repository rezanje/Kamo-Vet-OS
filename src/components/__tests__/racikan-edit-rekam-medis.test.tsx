// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/actions", () => ({ simpanRekamMedis: vi.fn(), koreksiRekamMedis: vi.fn(), koreksiRekamMedisLengkap: vi.fn() }));
vi.mock("@/components/PetPhotoUpload", () => ({ PetPhotoUpload: () => null }));
vi.mock("@/components/PenunjangUpload", () => ({ PenunjangUpload: () => null }));
import { RekamForm } from "@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm";
import type { KatalogRacikan } from "@/lib/katalog-racikan";
import type { ClinicalCorrection } from "@/lib/clinical-correction";

// Laporan Anisa 1 Nov 2026: di layar Edit rekam medis (sebelum tagihan terbit) tab
// "Tindakan & Racikan" tidak menampilkan racikan — cari "racik" → "Tidak ada tindakan / racikan cocok".
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const base = { unit: "pcs", stok: 5, sell_price: 10000, code: null as string | null, upc: null as string | null };
const vaksin = { ...base, id: "vaksin", name: "Vaksinasi F4", sell_price: 235000, item_type: "Jasa", tindakan_kategori: "Vaksin" };
const compound = { ...base, id: "compound", name: "Obat Racik Sirup Flu", unit: "PCS", stok: 0, sell_price: 25000, item_type: "Persediaan" };
const ingredient = { ...base, id: "ingredient", name: "Bahan diizinkan", sell_price: 5000, item_type: "Persediaan" };
const formula: KatalogRacikan = {
  id: "formula", code: "RCP-1", active: true, sale_item_id: "compound", version_id: "v1", version: 1,
  name: "Sirup Flu", dosage_form: "sirup", dosage_instruction: "3x sehari",
  ingredients: [{ item_id: "ingredient", name: "Bahan diizinkan", quantity: 2, unit: "pcs", unit_price: 5000 }],
};
const correction: ClinicalCorrection = {
  fullEdit: true, recordId: "record", revision: 1, anamnesis: "Tersimpan", diagnosis: null, therapy: null, suhu: null, berat: 3,
  gejala_klinis: null, hasil_penunjang: null, penunjang_urls: [], follow_up: null, catatan_resep: null,
  prescriptions: [
    { id: "rx-vaksin", item_id: "vaksin", nama_obat: "Vaksinasi F4", qty: 1, harga: 235000, satuan: "PCS", jenis: "jasa", aturan_pakai: null },
    { id: "rx-lama", nama_obat: "Racikan Lama", qty: 1, harga: 20000, satuan: "racikan", jenis: "obat", compound_recipe_id: "recipe-lama", aturan_pakai: null },
  ],
  compounds: [{ id: "recipe-lama", recipe_name: "Racikan Lama", status: "pending" }],
};
const patient = { name: "Milo", species: "Kucing", breed: null, noRM: "RM1", tglPeriksa: "1 Nov", dokter: "Dokter", dokterId: null, providerId: null,
  owner: "Pemilik", phone: "08123", address: "", tier: "Umum", keluhan: "Kontrol", photo: null };

async function render() {
  await act(async () => root.render(<RekamForm visitId="visit" petId="pet" requestKey="edit" draftUserId="owner" correction={correction}
    items={[ingredient]} racikanItems={[compound]} bahanItems={[ingredient]} jasaItems={[]} tindakanItems={[vaksin]}
    katalogRacikan={[formula]} bolehManual currentWeight={3} dokterOpsi={[]} providerOpsi={[]} patient={patient} />));
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === "Tindakan & Racikan")!.click());
}
const field = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
const click = (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
const cart = () => JSON.parse(host.querySelector<HTMLInputElement>('input[name="resep"]')!.value);
async function type(label: string, value: string) {
  const control = field(label)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
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

it("Edit rekam medis: mencari 'racik' di Tindakan & Racikan menampilkan obat racik", async () => {
  await render();
  await type("Cari tindakan / racikan", "racik");
  const picker = host.querySelector('section[aria-label="Pilih tindakan / racikan"]')!;
  expect(picker.textContent).not.toContain("Tidak ada tindakan / racikan cocok");
  expect(picker.querySelector('button[aria-label="Pilih Obat Racik Sirup Flu"]')).not.toBeNull();
});

it("Edit rekam medis: racikan baru masuk keranjang sebagai baris baru, racikan lama tetap terkunci", async () => {
  await render();
  await click('button[aria-label="Pilih Obat Racik Sirup Flu"]');
  await pickFrom("Komposisi racikan", "Sirup");
  await click('button[aria-label="Tambah Obat Racik Sirup Flu ke keranjang"]');
  const rows = cart();
  expect(rows).toHaveLength(3);
  // Baris tersimpan tetap dikirim apa adanya (tidak boleh hilang di Edit).
  expect(rows[0]).toMatchObject({ prescription_item_id: "rx-vaksin" });
  expect(rows[1]).toMatchObject({ prescription_item_id: "rx-lama", compound_recipe_id: "recipe-lama", jenis: "racikan" });
  // Racikan baru: tanpa id resep tersimpan, membawa SKU dan resep resmi untuk diracik saat disimpan.
  expect(rows[2]).toMatchObject({ jenis: "racikan", sale_item_id: "compound", official_version_id: "v1", harga: 25000 });
  expect(rows[2].prescription_item_id).toBeUndefined();
  expect(rows[2].compound_recipe_id).toBeUndefined();
  // Baris racikan baru tidak boleh "diganti item" menjadi obat/jasa biasa, tapi masih bisa dihapus/diubah.
  expect(field("Ganti item Obat Racik Sirup Flu")).toBeNull();
  expect(field("Ubah bahan Obat Racik Sirup Flu")).not.toBeNull();
  expect(field("Ganti item Vaksinasi F4")).not.toBeNull();
  // Racikan lama tetap lewat Aksi racikan (stok tidak keluar dua kali).
  expect(host.querySelector('a[href="/klinik/racik/recipe-lama"]')).not.toBeNull();
  expect(host.textContent).toContain("racikan baru");
});

it("Edit rekam medis: kolom catatan resep umum tidak ditampilkan karena tidak ikut tersimpan di koreksi", async () => {
  await render();
  expect(host.textContent).not.toContain("Catatan resep (aturan pakai) · racikan");
});
