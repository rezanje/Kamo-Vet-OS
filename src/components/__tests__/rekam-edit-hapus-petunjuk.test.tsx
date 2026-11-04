// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const tarik = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/actions", () => ({ simpanRekamMedis: vi.fn(), koreksiRekamMedis: vi.fn(), koreksiRekamMedisLengkap: vi.fn(), tarikItemRekamMedis: tarik }));
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
  tarik.mockReset();
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

// Laporan Andri 4 Nov 2026: item di keranjang Edit rekam medis "ga bisa dihapus" dan tidak ada penjelasan.
// Aturan database: baris resep tersimpan tidak dihapus dari Edit; yang belum ditagih bisa DITARIK (soft-withdraw,
// alasan wajib, tercatat). Racikan yang sudah diracik tetap bergembok (stok bahan sudah keluar).
it("Edit rekam medis: baris tersimpan non-racikan punya tombol Tarik, racikan tetap bergembok dengan petunjuk Aksi", async () => {
  await render();
  expect(host.querySelector('i.ti-x[title="Hapus"]')).toBeNull();
  expect([...host.querySelectorAll("[data-tarik-baris]")].map(b => b.getAttribute("aria-label"))).toEqual(["Tarik Vaksinasi F4"]);
  const kunci = [...host.querySelectorAll("[data-baris-terkunci]")];
  expect(kunci).toHaveLength(1);
  expect(kunci[0].getAttribute("title")).toContain("Aksi");
  const petunjuk = host.querySelector("[data-hapus-petunjuk]")?.textContent ?? "";
  expect(petunjuk).toContain("Tarik");
  expect(petunjuk).toContain("Ubah BMHP");
});

const klik = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };
const isi = async (el: HTMLInputElement, value: string) => { await act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); }); };

it("Tarik: panel meminta alasan (5-200), tombol konfirmasi mati sebelum valid, lalu memanggil aksi dan memindahkan baris ke daftar dicoret", async () => {
  tarik.mockResolvedValue({ ok: true, withdrawn: ["rx-vaksin"] });
  await render();
  expect(host.querySelector("[data-tarik-panel]")).toBeNull();
  await klik(host.querySelector("[data-tarik-baris]"));
  const panel = host.querySelector("[data-tarik-panel]")!;
  expect(panel.textContent).toContain("Vaksinasi F4");
  expect(panel.textContent).toContain("langsung tersimpan");
  const confirm = host.querySelector<HTMLButtonElement>("[data-tarik-konfirmasi]")!;
  expect(confirm.disabled).toBe(true);
  const alasan = host.querySelector<HTMLInputElement>('input[aria-label="Alasan penarikan"]')!;
  await isi(alasan, "abcd"); expect(confirm.disabled).toBe(true);
  await isi(alasan, "  Salah input, dobel  "); expect(confirm.disabled).toBe(false);
  await klik(confirm);
  expect(tarik).toHaveBeenCalledTimes(1);
  expect(tarik.mock.calls[0][0]).toMatchObject({ visitId: "visit", recordId: "record", itemIds: ["rx-vaksin"], reason: "Salah input, dobel" });
  expect(String(tarik.mock.calls[0][0].requestKey).length).toBeGreaterThan(8);
  expect(cart().map((row: { prescription_item_id: string }) => row.prescription_item_id)).toEqual(["rx-lama"]);
  const ditarik = host.querySelector("[data-item-ditarik]")!;
  expect(ditarik.textContent).toContain("Vaksinasi F4");
  expect(ditarik.textContent).toContain("Salah input, dobel");
  expect(ditarik.querySelector("s")?.textContent).toContain("Vaksinasi F4");
  expect(host.querySelector("[data-tarik-panel]")).toBeNull();
});

it("Tarik ditolak server: baris tetap di keranjang, pesan galat tampil, tidak tercatat sebagai ditarik", async () => {
  tarik.mockResolvedValue({ ok: false, error: "tagihan sudah terbit (termasuk yang dibatalkan); gunakan koreksi tagihan di Pembayaran" });
  await render();
  await klik(host.querySelector("[data-tarik-baris]"));
  await isi(host.querySelector<HTMLInputElement>('input[aria-label="Alasan penarikan"]')!, "Salah input obat");
  await klik(host.querySelector("[data-tarik-konfirmasi]"));
  expect(host.querySelector("[data-tarik-error]")?.textContent).toContain("koreksi tagihan");
  expect(cart().map((row: { prescription_item_id: string }) => row.prescription_item_id)).toEqual(["rx-vaksin", "rx-lama"]);
  expect(host.querySelector("[data-item-ditarik]")).toBeNull();
  await klik([...host.querySelectorAll("button")].find(b => b.textContent === "Batal") ?? null);
  expect(host.querySelector("[data-tarik-panel]")).toBeNull();
});

it("Tarik paket: semua baris tersimpan dari paket yang sama ditarik sekaligus; asal paket ikut terkirim saat Simpan", async () => {
  tarik.mockResolvedValue({ ok: true, withdrawn: ["rx-p1", "rx-p2"] });
  const paket = { ...correction, prescriptions: [
    { id: "rx-p1", item_id: "ingredient", nama_obat: "Jasa Paket", qty: 1, harga: 90000, satuan: "kali", jenis: "jasa", aturan_pakai: null, package_item_id: "11111111-1111-4111-8111-111111111111", package_qty: 1 },
    { id: "rx-p2", item_id: "ingredient", nama_obat: "Bahan Paket", qty: 1, harga: 1000, satuan: "pcs", jenis: "obat", aturan_pakai: null, package_item_id: "11111111-1111-4111-8111-111111111111", package_qty: 1 },
    { id: "rx-lain", item_id: "ingredient", nama_obat: "Obat Lain", qty: 1, harga: 5000, satuan: "pcs", jenis: "obat", aturan_pakai: null },
  ] };
  await act(async () => root.render(<RekamForm visitId="visit" petId="pet" requestKey="edit" draftUserId="owner" correction={paket}
    items={[ingredient]} racikanItems={[compound]} bahanItems={[ingredient]} jasaItems={[]} tindakanItems={[vaksin]}
    katalogRacikan={[formula]} bolehManual currentWeight={3} dokterOpsi={[]} providerOpsi={[]} patient={patient} />));
  expect(cart().filter((row: { package_item_id?: string }) => row.package_item_id).map((row: { package_item_id: string; package_qty: number }) => [row.package_item_id, row.package_qty]))
    .toEqual([["11111111-1111-4111-8111-111111111111", 1], ["11111111-1111-4111-8111-111111111111", 1]]);
  await klik(host.querySelectorAll("[data-tarik-baris]")[0]);
  expect(host.querySelector("[data-tarik-panel]")!.textContent).toContain("paket");
  await isi(host.querySelector<HTMLInputElement>('input[aria-label="Alasan penarikan"]')!, "Paket salah pilih");
  await klik(host.querySelector("[data-tarik-konfirmasi]"));
  expect(tarik.mock.calls[0][0].itemIds).toEqual(["rx-p1", "rx-p2"]);
  expect(cart().map((row: { prescription_item_id: string }) => row.prescription_item_id)).toEqual(["rx-lain"]);
});

it("Rekam medis baru (bukan Edit): tidak ada gembok maupun petunjuk", async () => {
  await act(async () => root.render(<RekamForm visitId="visit" petId="pet" requestKey="new" draftUserId="owner"
    items={[ingredient]} racikanItems={[compound]} bahanItems={[ingredient]} jasaItems={[]} tindakanItems={[vaksin]}
    katalogRacikan={[formula]} bolehManual currentWeight={3} dokterOpsi={[]} providerOpsi={[]} patient={patient} />));
  expect(host.querySelector("[data-baris-terkunci]")).toBeNull();
  expect(host.querySelector("[data-tarik-baris]")).toBeNull();
  expect(host.querySelector("[data-hapus-petunjuk]")).toBeNull();
});

it("Edit rekam medis: baris tersimpan tetap terkirim apa adanya", async () => {
  await render();
  expect(cart().map((row: { prescription_item_id: string }) => row.prescription_item_id)).toEqual(["rx-vaksin", "rx-lama"]);
});

const render1 = async (prescriptions: ClinicalCorrection["prescriptions"]) => {
  await act(async () => root.render(<RekamForm visitId="visit" petId="pet" requestKey="edit" draftUserId="owner" correction={{ ...correction, prescriptions, compounds: [] }}
    items={[ingredient]} racikanItems={[compound]} bahanItems={[ingredient]} jasaItems={[]} tindakanItems={[vaksin]}
    katalogRacikan={[formula]} bolehManual currentWeight={3} dokterOpsi={[]} providerOpsi={[]} patient={patient} />));
};
const satu = { id: "rx-satu", item_id: "vaksin", nama_obat: "Vaksinasi F4", qty: 1, harga: 235000, satuan: "PCS", jenis: "jasa", aturan_pakai: null };
const dua = { id: "rx-dua", item_id: "ingredient", nama_obat: "Obat Dua", qty: 1, harga: 5000, satuan: "pcs", jenis: "obat", aturan_pakai: null };

it("Tarik: alasan hanya tanda baca / zero-width / spasi tidak membuka tombol konfirmasi (aturan sama dengan database)", async () => {
  await render();
  await klik(host.querySelector("[data-tarik-baris]"));
  const confirm = host.querySelector<HTMLButtonElement>("[data-tarik-konfirmasi]")!;
  const alasan = host.querySelector<HTMLInputElement>('input[aria-label="Alasan penarikan"]')!;
  for (const bad of [".....", "\u200b".repeat(5), "?! - ?!", "     "]) { await isi(alasan, bad); expect(confirm.disabled, JSON.stringify(bad)).toBe(true); }
  await isi(alasan, "a b c d e"); expect(confirm.disabled).toBe(false);
  expect(tarik).not.toHaveBeenCalled();
});

it("Tarik baris TERAKHIR: peringatan 'minimal satu baris harus tersisa' + tombol berlabel khusus; tetap bisa dilanjutkan (database mengizinkan, tagihan pulih setelah item ditambah)", async () => {
  tarik.mockResolvedValue({ ok: true, withdrawn: ["rx-satu"] });
  await render1([satu]);
  await klik(host.querySelector("[data-tarik-baris]"));
  const warn = host.querySelector("[data-tarik-peringatan-terakhir]");
  expect(warn?.textContent).toContain("minimal satu baris harus tersisa");
  expect(warn?.textContent).toContain("arsip");
  const confirm = host.querySelector<HTMLButtonElement>("[data-tarik-konfirmasi]")!;
  expect(confirm.textContent).toContain("baris terakhir");
  await isi(host.querySelector<HTMLInputElement>('input[aria-label="Alasan penarikan"]')!, "Salah input kunjungan");
  await klik(confirm);
  expect(tarik).toHaveBeenCalledTimes(1);
  expect(tarik.mock.calls[0][0]).toMatchObject({ itemIds: ["rx-satu"] });
});

it("Tarik bukan baris terakhir (masih ada baris lain, termasuk baris baru yang belum disimpan): tanpa peringatan", async () => {
  await render1([satu, dua]);
  await klik(host.querySelector("[data-tarik-baris]"));
  expect(host.querySelector("[data-tarik-peringatan-terakhir]")).toBeNull();
  expect(host.querySelector<HTMLButtonElement>("[data-tarik-konfirmasi]")!.textContent).toBe("Ya, tarik");
});
