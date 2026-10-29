// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { KatalogRacikan } from "@/lib/katalog-racikan";

// Laporan Andri 29 Okt: di halaman rekam medis yang dibuka ulang (Detail), kartu
// "Obat racikan" → "Racikan baru" tidak bisa diisi dan tidak memberi pesan apa pun.
// Racikan di sini harus bekerja persis seperti form pemeriksaan "Tindakan & Racikan".
const fixture = vi.hoisted(() => ({
  skus: [] as Record<string, unknown>[],
  materials: [] as Record<string, unknown>[],
  catalog: [] as KatalogRacikan[],
  saved: [] as Record<string, string>[],
}));
vi.mock("@/app/(app)/klinik/racik/actions", () => ({
  addRacikan: async (data: FormData) => {
    fixture.saved.push(Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value)])));
  },
  bahanRacikanUntukKunjungan: async () => fixture.materials,
  katalogRacikanUntukKunjungan: async () => fixture.catalog,
  obatRacikUntukKunjungan: async () => fixture.skus,
}));
import { RacikanInline } from "@/app/(app)/klinik/rekam-medis/[visitId]/RacikanInline";

const base = { unit: "pcs", stok: 5, code: null as string | null };
const compound = { ...base, id: "compound", name: "Obat Racik Sirup", unit: "PCS", stok: 0, sell_price: 25000 };
const compoundB = { ...base, id: "compound-b", name: "Obat Racik Puyer", sell_price: 30000 };
const ingredient = { ...base, id: "ingredient", name: "Bahan diizinkan", sell_price: 5000, stok: 9 };
const formula: KatalogRacikan = {
  id: "formula", code: "RCP-1", active: true, sale_item_id: "compound", version_id: "v1", version: 1,
  name: "Puyer Batuk", dosage_form: "puyer", dosage_instruction: "3x sehari 1 bungkus",
  ingredients: [{ item_id: "ingredient", name: "Bahan diizinkan", quantity: 2, unit: "pcs", unit_price: 5000 }],
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  fixture.skus = [compound, compoundB]; fixture.materials = [ingredient]; fixture.catalog = []; fixture.saved = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const field = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
const button = (text: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.trim() === text);
const simpan = () => host.querySelector<HTMLButtonElement>('button[aria-label="Simpan racikan"]');
const click = (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());

async function buka(bolehManual = true) {
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<RacikanInline visitId="visit" medicalRecordId="record" bahanItems={[]} bolehManual={bolehManual} />));
  await act(async () => button("Racikan baru")!.click());
}
/** Pemilih bawaan form pemeriksaan: fokus menampilkan daftar, tanpa harus mengetik. */
function options(label: string) {
  const picker = field(label)!;
  expect(picker, label).not.toBeNull();
  act(() => picker.focus());
  return [...document.querySelectorAll("[role=option]")].map(option => option.textContent ?? "");
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
async function type(label: string, value: string) {
  const control = field(label)!;
  expect(control, label).not.toBeNull();
  const proto = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

it("lists every active compound SKU before typing, like the examination form", async () => {
  await buka();
  expect(host.querySelector('section[aria-label="Pilih racikan"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="Pilih Obat Racik Sirup"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="Pilih Obat Racik Puyer"]')).not.toBeNull();
  // Editor lama memakai kolom "Cari obat racik" + "Cari bahan baku…" tersendiri.
  expect(field("Cari obat racik")).toBeNull();
  expect(field("Cari bahan racikan")).toBeNull();
});

it("shows the material picker filled without typing once a compound is picked", async () => {
  await buka();
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  expect(host.textContent).toContain("Komposisi racikan");
  expect(field("Bentuk racikan")).not.toBeNull();
  expect(field("Aturan pakai racikan")).not.toBeNull();
  // Inti laporan: bahan harus kelihatan tanpa mengetik dulu.
  expect(options("Tambah bahan Obat Racik Sirup")).toEqual([expect.stringContaining("Bahan diizinkan")]);
});

it("explains in plain Indonesian why the save button stays disabled", async () => {
  await buka();
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  expect(simpan()!.disabled).toBe(true);
  expect(host.querySelector('[role=alert]')!.textContent).toContain("Tambah minimal satu bahan racikan");
  await pickFrom("Tambah bahan Obat Racik Sirup", "Bahan");
  expect(simpan()!.disabled).toBe(false);
  await type("Jumlah bahan Bahan diizinkan", "0");
  expect(simpan()!.disabled).toBe(true);
  expect(host.querySelector('[role=alert]')!.textContent).toContain("jumlah tiap bahan");
});

it("tells a user without custom-compound permission what to ask for", async () => {
  await buka(false);
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  expect(field("Tambah bahan Obat Racik Sirup")).toBeNull();
  expect(simpan()!.disabled).toBe(true);
  expect(host.querySelector('[role=alert]')!.textContent)
    .toContain("Resep resmi belum ada — minta Owner/Admin aktifkan racikan khusus");
  fixture.catalog = [formula];
  await buka(false);
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  expect(host.querySelector('[role=alert]')!.textContent).toContain("Pilih resep resmi dulu");
});

it("keeps the addRacikan payload of a patient compound unchanged", async () => {
  await buka();
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  await pickFrom("Tambah bahan Obat Racik Sirup", "Bahan");
  await type("Jumlah bahan Bahan diizinkan", "3");
  await type("Bentuk racikan", "kapsul");
  await type("Aturan pakai racikan", "2x sehari");
  await act(async () => simpan()!.click());
  expect(fixture.saved).toHaveLength(1);
  expect(fixture.saved[0]).toMatchObject({
    visitId: "visit", medicalRecordId: "record", sale_item_id: "compound", recipe_name: "Obat Racik Sirup",
    official_version_id: "", dosage_form: "kapsul", aturan_pakai: "2x sehari",
    ingredients: JSON.stringify([{ item_id: "ingredient", nama: "Bahan diizinkan", qty: 3, satuan: "pcs", harga: 5000 }]),
  });
  expect(fixture.saved[0].requestKey).toBeTruthy();
});

it("keeps the addRacikan payload of an official recipe unchanged", async () => {
  fixture.catalog = [formula];
  await buka();
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  await pickFrom("Komposisi racikan", "Puyer");
  expect(host.textContent).toContain("Bahan diizinkan × 2 pcs");
  expect(field("Bentuk racikan")!.value).toBe("puyer");
  expect(field("Aturan pakai racikan")!.value).toBe("3x sehari 1 bungkus");
  await act(async () => simpan()!.click());
  expect(fixture.saved[0]).toMatchObject({
    sale_item_id: "compound", official_version_id: "v1", dosage_form: "puyer",
    aturan_pakai: "3x sehari 1 bungkus", ingredients: "[]",
  });
});

it("offers only the formulas bound to the picked SKU and refuses a stale one", async () => {
  fixture.catalog = [formula,
    { ...formula, id: "lain", version_id: "v-lain", sale_item_id: "compound-b" },
    { ...formula, id: "lepas", version_id: "v-lepas", sale_item_id: null },
    { ...formula, id: "mati", version_id: "v-mati", active: false },
  ];
  await buka();
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  expect(options("Komposisi racikan")).toEqual([expect.stringContaining("Puyer Batuk (v1)")]);
});

it("copies an official recipe into an editable patient composition", async () => {
  fixture.catalog = [formula];
  await buka();
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  await pickFrom("Komposisi racikan", "Puyer");
  await act(async () => button("Sesuaikan komposisi untuk pasien")!.click());
  expect(field("Jumlah bahan Bahan diizinkan")!.value).toBe("2");
  await type("Jumlah bahan Bahan diizinkan", "4");
  await act(async () => simpan()!.click());
  expect(fixture.saved[0]).toMatchObject({
    official_version_id: "", dosage_form: "puyer", aturan_pakai: "3x sehari 1 bungkus",
    ingredients: JSON.stringify([{ item_id: "ingredient", nama: "Bahan diizinkan", qty: 4, satuan: "pcs", harga: 5000 }]),
  });
});

it("never offers the patient copy without permission or with mismatched units", async () => {
  fixture.catalog = [formula];
  await buka(false);
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  await pickFrom("Komposisi racikan", "Puyer");
  expect(button("Sesuaikan komposisi untuk pasien")).toBeUndefined();
  fixture.materials = [{ ...ingredient, unit: "gram" }];
  await buka();
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  await pickFrom("Komposisi racikan", "Puyer");
  expect(button("Sesuaikan komposisi untuk pasien")).toBeUndefined();
  expect(host.textContent).toContain("bahan atau satuan aktif tidak cocok");
});

it("clears the patient composition when another compound SKU is picked", async () => {
  await buka();
  await click('button[aria-label="Pilih Obat Racik Sirup"]');
  await pickFrom("Tambah bahan Obat Racik Sirup", "Bahan");
  await type("Aturan pakai racikan", "2x sehari");
  await click('button[aria-label="Pilih Obat Racik Puyer"]');
  expect(field("Jumlah bahan Bahan diizinkan")).toBeNull();
  expect(field("Aturan pakai racikan")!.value).toBe("");
  expect(simpan()!.disabled).toBe(true);
});
