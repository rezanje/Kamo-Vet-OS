// @vitest-environment jsdom
// B1 (meeting 12 Nov 2026): beberapa racikan dalam satu simpan di rawat inap. Racikan yang sedang
// disusun tidak boleh hilang diam-diam saat dokter memilih racikan/tindakan lain.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ addDailyLogPos: vi.fn() }));
vi.mock("@/components/PetPhotoUpload", () => ({ PetPhotoUpload: () => null }));
vi.mock("@/components/PenunjangUpload", () => ({ PenunjangUpload: () => null }));
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

// Data fiktif.
const base = { unit: "pcs", stok: 5, sell_price: 10000, category_id: null as string | null, is_compound_material: false,
  code: null as string | null, upc: null as string | null };
const action = { ...base, id: "steril", name: "Steril", sell_price: 75000, item_type: "Jasa", category_id: "actions", tindakan_kategori: "Operasi" };
const ingredient = { ...base, id: "ingredient", name: "Bahan diizinkan", item_type: "Persediaan", is_compound_material: true };
const kapsul = { ...base, id: "kapsul", name: "Racik Kapsul", item_type: "Persediaan", category_id: "actions" };
const vitamin = { ...base, id: "vitamin", name: "Racik Vitamin", item_type: "Persediaan", category_id: "actions" };
const groups = splitClinicItems([action, ingredient, kapsul, vitamin], [{ id: "actions", name: "TINDAKAN" }], new Set([kapsul.id, vitamin.id]));
const patient = { name: "Milo", species: "Kucing", breed: null, noRM: "RM1", owner: "Pemilik", phone: "08123", address: "", photo: null, dokter: "Dokter", tglMasuk: "12 Nov", kondisi: "Stabil" };

async function render() {
  await act(async () => root.render(<CatatanForm requestKey="request" draftUserId="owner" items={groups.obat} jasaItems={groups.jasa}
    tindakanItems={groups.tindakan} bahanItems={groups.bahan} racikanItems={groups.racikan} katalogRacikan={[]} bolehManual
    recordId="inpatient" backHref="/klinik/rawat-inap/inpatient" patient={patient} />));
  const tab = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === "Tindakan & Racikan")!;
  await act(async () => tab.click());
}
const tombol = (teks: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === teks);
const klik = async (el: HTMLElement | null | undefined) => { expect(el).toBeTruthy(); await act(async () => el!.click()); };
const pilih = (nama: string) => klik(host.querySelector<HTMLButtonElement>(`button[aria-label="Pilih ${nama}"]`));
async function isiBahan(nama: string) {
  const picker = host.querySelector<HTMLInputElement>(`input[aria-label="Tambah bahan ${nama}"]`)!;
  expect(picker, nama).not.toBeNull();
  await act(async () => {
    picker.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(picker, "Bahan");
    picker.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => picker.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  await act(async () => picker.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
}
const cart = () => JSON.parse(host.querySelector<HTMLInputElement>('input[name="resep"]')!.value) as { sale_item_id?: string; jenis: string }[];
const dialog = () => host.querySelector('[role="alertdialog"]');

it("menampilkan petunjuk cara memasukkan beberapa racikan", async () => {
  await render();
  expect(host.textContent).toContain("Beberapa racikan sekaligus");
});

it("memilih racikan lain saat racikan pertama belum masuk keranjang: ditanya dulu, lalu keduanya bisa masuk keranjang", async () => {
  await render();
  await pilih("Racik Kapsul"); await isiBahan("Racik Kapsul");
  await pilih("Racik Vitamin");
  expect(dialog()?.textContent).toContain('Racikan "Racik Kapsul" belum masuk keranjang');
  expect(cart()).toEqual([]);
  // Dulu: racikan kapsul langsung terbuang. Sekarang: masukkan dulu, lalu lanjut ke racikan vitamin.
  await klik(tombol("Masukkan ke keranjang & lanjut"));
  expect(dialog()).toBeNull();
  expect(cart().map(row => row.sale_item_id)).toEqual(["kapsul"]);
  await isiBahan("Racik Vitamin");
  await klik(tombol("Tambah ke keranjang"));
  expect(cart().map(row => [row.sale_item_id, row.jenis])).toEqual([["kapsul", "racikan"], ["vitamin", "racikan"]]);
});

it("pilihan Buang meneruskan ke racikan baru tanpa memasukkan yang lama; Batal mempertahankan racikan yang sedang disusun", async () => {
  await render();
  await pilih("Racik Kapsul"); await isiBahan("Racik Kapsul");
  await pilih("Racik Vitamin");
  await klik(tombol("Batal"));
  expect(dialog()).toBeNull();
  expect(host.querySelector('input[aria-label="Tambah bahan Racik Kapsul"]')).not.toBeNull();
  expect(host.querySelector('input[aria-label="Jumlah bahan Bahan diizinkan"]')).not.toBeNull();

  await pilih("Steril");
  expect(dialog()?.textContent).toContain('tindakan "Steril"');
  await klik(tombol("Buang racikan ini"));
  expect(cart()).toEqual([]);
  expect(host.querySelector('input[aria-label="Tambah BMHP Steril"]')).not.toBeNull();
});

it("racikan kosong (belum ada bahan) tidak memicu pertanyaan", async () => {
  await render();
  await pilih("Racik Kapsul");
  await pilih("Racik Vitamin");
  expect(dialog()).toBeNull();
  expect(host.querySelector('input[aria-label="Tambah bahan Racik Vitamin"]')).not.toBeNull();
});
