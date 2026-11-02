// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/actions", () => ({ simpanRekamMedis: vi.fn() }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
vi.mock("@/components/PetPhotoUpload", () => ({ PetPhotoUpload: () => null }));
vi.mock("@/components/PenunjangUpload", () => ({ PenunjangUpload: () => null }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: () => null }));
import { RekamForm } from "@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm";
import { ItemTable, PembayaranForm } from "@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";
import { splitClinicItems } from "@/lib/clinic-item-categories";
import { isiDitagihPerPaket, type ResepPaket } from "@/lib/paket-klinik";

/** Fiksi: paket steril = tindakan steril + 2 spuit + 1 benang, harga paket Rp300.000. */
const resep: ResepPaket = { id: "paket-steril", name: "Paket Steril", komponen: [
  { item_id: "steril", name: "Steril", item_type: "Jasa", base_unit: "x", qty: 1, unit: "x", factor: 1, tindakan_kategori: "Operasi" },
  { item_id: "spuit", name: "Spuit", item_type: "Persediaan", base_unit: "pcs", qty: 2, unit: "pcs", factor: 1 },
  { item_id: "benang", name: "Benang", item_type: "Persediaan", base_unit: "pcs", qty: 1, unit: "pcs", factor: 1 },
] };
const base = { unit: "pcs", stok: 10, category_id: null as string | null, is_compound_material: false, code: null as string | null, upc: null as string | null };
const steril = { ...base, id: "steril", name: "Steril", sell_price: 250000, item_type: "Jasa", category_id: "actions", tindakan_kategori: "Operasi", unit: "x" };
const spuit = { ...base, id: "spuit", name: "Spuit", sell_price: 5000, item_type: "Persediaan" };
const benang = { ...base, id: "benang", name: "Benang", sell_price: 40000, item_type: "Persediaan" };
const paket = { ...base, id: "paket-steril", name: "Paket Steril", sell_price: 300000, item_type: "Grup", stok: 3 };
const categories = [{ id: "actions", name: "TINDAKAN" }];

let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("splits Grup items into their own list, never into Jasa/Tindakan", () => {
  const groups = splitClinicItems([steril, spuit, benang, { ...paket, category_id: "actions" }], categories, new Set());
  expect(groups.paket.map(item => item.id)).toEqual(["paket-steril"]);
  expect(groups.tindakan.map(item => item.id)).toEqual(["steril"]);
  expect(groups.obat.map(item => item.id)).toEqual(["spuit", "benang"]);
});

it("rekam medis: a package picked from Obat fills the cart with its contents at the package price, without asking BMHP", async () => {
  const groups = splitClinicItems([steril, spuit, benang], categories, new Set());
  const patient = { name: "Milo", species: "Kucing", breed: null, noRM: "RM1", owner: "Pemilik", phone: "08123", address: "", photo: null, dokter: "Dokter",
    tglPeriksa: "2 Nov", dokterId: null, providerId: null, tier: "Umum", keluhan: "Steril" };
  await act(async () => root.render(<RekamForm requestKey="request" draftUserId="owner" items={[...groups.obat, paket]} jasaItems={groups.jasa}
    tindakanItems={groups.tindakan} bahanItems={[]} racikanItems={[]} katalogRacikan={[]} bolehManual visitId="visit" petId="pet"
    currentWeight={null} dokterOpsi={[]} providerOpsi={[]} patient={patient} paketResep={{ [resep.id]: resep }} />));
  const cart = () => JSON.parse(host.querySelector<HTMLInputElement>('input[name="resep"]')!.value) as { item_id: string; jenis: string; qty: number; harga: number }[];
  const tambah = async () => {
    const row = [...host.querySelectorAll("tr")].find(tr => tr.textContent?.includes("Paket Steril") && tr.querySelector("button"))!;
    await act(async () => row.querySelector<HTMLButtonElement>("button")!.click());
  };
  await tambah();
  expect(cart().map(row => [row.item_id, row.jenis, row.qty])).toEqual([["steril", "jasa", 1], ["spuit", "obat", 2], ["benang", "obat", 1]]);
  expect(cart().reduce((sum, row) => sum + row.qty * row.harga, 0)).toBe(300000);
  // Anisa 2 Nov: satu baris seperti tindakan — nama & harga paket, isinya kecil tanpa harga.
  const paketRows = host.querySelectorAll('tr[data-paket="paket-steril"]');
  expect(paketRows).toHaveLength(1);
  expect(paketRows[0].textContent).toContain("Rp 300.000 / paket");
  expect(paketRows[0].textContent).toContain("ISI PAKET");
  expect(paketRows[0].textContent).toContain("Spuit × 2 pcs");
  expect(paketRows[0].textContent).not.toContain("Rp 5.000");
  expect([...host.querySelectorAll("strong[data-cart-item]")].map(node => node.textContent)).toEqual(["Paket Steril"]);
  // Tindakan di dalam paket tidak meminta isian BMHP lagi.
  expect(host.querySelector('button[aria-label="Ubah BMHP Steril"]')).toBeNull();
  // Dipilih lagi = dua paket, bukan baris dobel.
  await tambah();
  expect(cart().map(row => row.qty)).toEqual([2, 4, 2]);
  expect(cart().reduce((sum, row) => sum + row.qty * row.harga, 0)).toBe(600000);
  // Jumlah paket diketik langsung.
  const jumlah = host.querySelector<HTMLInputElement>('input[aria-label="Jumlah paket Paket Steril"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(jumlah, "3");
    jumlah.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(cart().map(row => row.qty)).toEqual([3, 6, 3]);
  // Menghapus paket menghapus seluruh isinya.
  await act(async () => host.querySelector<HTMLElement>('i[aria-label="Hapus paket Paket Steril"]')!.click());
  expect(cart()).toEqual([]);
});

const unit = (sell_price: number, u = "pcs") => [{ unit: u, factor: 1, sell_price, buy_price: 0 }];
const masterObat = [
  { id: "spuit", code: "SP", name: "Spuit", unit: "pcs", harga: 5000, units: unit(5000) },
  { id: "benang", code: "BN", name: "Benang", unit: "pcs", harga: 40000, units: unit(40000) },
  { id: "paket-steril", code: "PK", name: "Paket Steril", unit: "pcs", harga: 300000, units: unit(300000), paket: true },
];
const masterJasa = [{ id: "steril", code: "ST", name: "Steril", unit: "x", harga: 250000, units: unit(250000, "x"), tindakan_kategori: "Operasi" }];
const packages = [{ id: resep.id, name: resep.name, componentIds: ["steril", "spuit", "benang"], perPaket: isiDitagihPerPaket(resep), resep }];

it("pembayaran: choosing a package in the Obat table hands it to the package expansion", () => {
  const picked: [number, string][] = [];
  const tree = ItemTable({ title: "OBAT", icon: "pill", color: "black", rows: [{ deskripsi: "", qty: 1, harga: 0 }], setRows: () => {},
    master: masterObat, listId: "obat", packages, onPickPackage: (i, id) => { picked.push([i, id]); } });
  const find = (node: React.ReactNode): React.ReactElement<Record<string, unknown>> | undefined => {
    if (!React.isValidElement<Record<string, unknown>>(node)) return;
    if (typeof node.type === "function" && node.type.name === "SearchableItemPicker") return node;
    for (const child of React.Children.toArray(node.props.children as React.ReactNode)) { const hit = find(child); if (hit) return hit; }
  };
  const picker = find(tree)!;
  expect((picker.props.items as { name: string }[]).map(item => item.name)).toContain("Paket · Paket Steril");
  (picker.props.onChange as (id: string) => void)("paket-steril");
  expect(picked).toEqual([[0, "paket-steril"]]);
});

it("pembayaran: package contents from the medical record are recognised and tagged with their package", () => {
  const props = { visitId: "visit", requestKey: "request", catatanResep: null, masterObat, masterJasa, packages,
    patient: { photo: null, name: "Milo", species: "Kucing", owner: "Owner", phone: "", address: "", dokter: "Doctor", jenisLayanan: "Klinik", noInvoice: "(baru)", tanggal: "2026-11-02" },
    bekal: { promos: [], aturanDiskon: [], golonganPersen: 0, infoBarang: {}, vouchers: [], hariIni: "2026-11-02", customerId: null, categoryId: null, poinSaldo: 0, rupiahPerPoin: 1 } };
  // Harga hasil pembagian rekam medis (lihat tes di atas): total Rp300.000.
  const html = renderToStaticMarkup(React.createElement(PembayaranForm, { ...props,
    initialObat: [
      { deskripsi: "Spuit", qty: 2, harga: 4545, item_id: "spuit", satuan: "pcs", prescription_item_id: "p2" },
      { deskripsi: "Benang", qty: 1, harga: 36364, item_id: "benang", satuan: "pcs", prescription_item_id: "p3" },
    ],
    initialJasa: [{ deskripsi: "Steril", qty: 1, harga: 254546, item_id: "steril", satuan: "x", prescription_item_id: "p1" }] }));
  // Satu baris paket (termasuk isi jasanya) di tabel Obat, harga paket, isi tanpa harga.
  expect(html.match(/data-paket="paket-steril"/g)).toHaveLength(1);
  expect(html).toContain("ISI PAKET");
  expect(html).toContain("Rp 300.000");
  expect(html).not.toContain("Rp 4.545");
  expect(html).toContain('aria-label="Jumlah paket Paket Steril"');
  // Yang dikirim tetap baris isinya, jasa tetap berjenis jasa, semuanya bertanda paket.
  const items = JSON.parse(html.match(/name="items" value="([^"]*)"/)![1].replace(/&quot;/g, '"')) as { item_id: string; jenis: string; package_item_id: string; package_qty: number }[];
  expect(items.map(row => [row.item_id, row.jenis, row.package_item_id, row.package_qty])).toEqual([
    ["spuit", "obat", "paket-steril", 1], ["benang", "obat", "paket-steril", 1], ["steril", "jasa", "paket-steril", 1]]);
  // Tanpa kecocokan harga, baris tetap penjualan biasa.
  const biasa = renderToStaticMarkup(React.createElement(PembayaranForm, { ...props,
    initialObat: [{ deskripsi: "Spuit", qty: 2, harga: 5000, item_id: "spuit", satuan: "pcs", prescription_item_id: "p2" }], initialJasa: [] }));
  expect(biasa).not.toContain('data-paket="paket-steril"');
});
