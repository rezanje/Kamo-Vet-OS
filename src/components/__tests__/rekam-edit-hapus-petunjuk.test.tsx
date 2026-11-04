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
}
const cart = () => JSON.parse(host.querySelector<HTMLInputElement>('input[name="resep"]')!.value);

// Laporan Andri 4 Nov 2026: item di keranjang Edit rekam medis "ga bisa dihapus" dan tidak ada
// penjelasan. Aturan database: baris resep tersimpan tidak boleh dihapus dari Edit (RECORD_INVALID);
// layar harus menunjukkan itu — bukan sekadar menghilangkan tombol hapus.
it("Edit rekam medis: baris tersimpan tampil gembok + petunjuk cara menghapus, tanpa tombol hapus", async () => {
  await render();
  expect(host.querySelector('i.ti-x[title="Hapus"]')).toBeNull();
  const kunci = [...host.querySelectorAll('[data-baris-terkunci]')];
  expect(kunci).toHaveLength(2);
  expect(kunci[0].getAttribute("title")).toContain("Pembayaran");
  expect(kunci[1].getAttribute("title")).toContain("Aksi");
  const petunjuk = host.querySelector("[data-hapus-petunjuk]")?.textContent ?? "";
  expect(petunjuk).toContain("Pembayaran");
  expect(petunjuk).toContain("Ubah BMHP");
});

it("Rekam medis baru (bukan Edit): tidak ada gembok maupun petunjuk", async () => {
  await act(async () => root.render(<RekamForm visitId="visit" petId="pet" requestKey="new" draftUserId="owner"
    items={[ingredient]} racikanItems={[compound]} bahanItems={[ingredient]} jasaItems={[]} tindakanItems={[vaksin]}
    katalogRacikan={[formula]} bolehManual currentWeight={3} dokterOpsi={[]} providerOpsi={[]} patient={patient} />));
  expect(host.querySelector("[data-baris-terkunci]")).toBeNull();
  expect(host.querySelector("[data-hapus-petunjuk]")).toBeNull();
});

it("Edit rekam medis: baris tersimpan tetap terkirim apa adanya", async () => {
  await render();
  expect(cart().map((row: { prescription_item_id: string }) => row.prescription_item_id)).toEqual(["rx-vaksin", "rx-lama"]);
});
