// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/actions", () => ({ simpanRekamMedis: vi.fn() }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ addDailyLogPos: vi.fn(), addInpatientBillables: vi.fn() }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
vi.mock("@/components/PetPhotoUpload", () => ({ PetPhotoUpload: () => null }));
vi.mock("@/components/PenunjangUpload", () => ({ PenunjangUpload: () => null }));
import { RekamForm } from "@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm";
import { CatatanForm } from "@/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm";
import { ItemTable, type MasterItem } from "@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";
import { TindakanRacikanForm, type FormItem } from "@/components/TindakanRacikanForm";

// Paket B — rendered component evidence (unit level, bukan UAT peramban):
// tiap jalur input klinik menampilkan stok gudang klinik transaksi dalam satuan baris,
// "belum terbaca" tidak pernah tampil sebagai 0, dan kekurangan terlihat sebelum disimpan.
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const base = { code: null as string | null, upc: null as string | null, sell_price: 1000, item_type: "Persediaan" };
const units = (dasar: string, extra: { unit: string; factor: number }[] = []) =>
  [{ unit: dasar, factor: 1, sell_price: 1000, buy_price: 0 }, ...extra.map(u => ({ ...u, sell_price: 1000 * u.factor, buy_price: 0 }))];
const unread = { ...base, id: "unread", name: "Obat belum terbaca", unit: "pcs", stok: null, units: units("pcs") };
const empty = { ...base, id: "empty", name: "Obat habis", unit: "pcs", stok: 0, units: units("pcs") };
const boxed = { ...base, id: "boxed", name: "Obat berkotak", unit: "pcs", stok: 25, units: units("pcs", [{ unit: "box", factor: 10 }]) };
const gauze = { ...base, id: "gauze", name: "Kasa steril", unit: "lembar", stok: 9, units: units("lembar", [{ unit: "pak", factor: 10 }]) };
// Tindakan berjenis Persediaan dengan stok induk 0: dengan BMHP, yang diperiksa bahannya.
const operasi = { ...base, id: "operasi", name: "Operasi Steril", unit: "pcs", stok: 0, tindakan_kategori: "Operasi", units: units("pcs") };
const compound = { ...base, id: "compound", name: "Obat Racik Sirup", unit: "PCS", stok: 0, units: units("PCS") };
const ingredient = { ...base, id: "ingredient", name: "Bahan sirup", unit: "ml", stok: null, units: units("ml") };
const common = {
  requestKey: "request", draftUserId: "owner", items: [unread, empty, boxed, gauze],
  jasaItems: [{ ...base, id: "consult", name: "Konsultasi", unit: "kali", stok: 0, item_type: "Jasa" }],
  tindakanItems: [operasi], bahanItems: [ingredient], racikanItems: [compound], katalogRacikan: [], bolehManual: true,
};
const patient = { name: "Milo", species: "Kucing", breed: null, noRM: "RM1", owner: "Pemilik", phone: "08123", address: "", photo: null, dokter: "Dokter" };

async function render(kind: "exam" | "obat-khusus" | "laporan-visit") {
  await act(async () => root.render(kind === "exam"
    ? <RekamForm {...common} visitId="visit" petId="pet" currentWeight={null} dokterOpsi={[]} providerOpsi={[]}
      patient={{ ...patient, tglPeriksa: "29 Oct", dokterId: null, providerId: null, tier: "Umum", keluhan: "Kontrol" }} />
    : <CatatanForm {...common} mode={kind === "obat-khusus" ? "billables" : "clinical"} recordId="inpatient" backHref="/klinik/rawat-inap/inpatient"
      patient={{ ...patient, tglMasuk: "29 Oct", kondisi: "Stabil" }} />));
}
const click = (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
const field = <T extends Element = HTMLInputElement>(selector: string) => host.querySelector<T & HTMLInputElement>(selector);
async function setValue(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function pickFrom(label: string, query: string) {
  const picker = field(`[aria-label="${label}"]`)!;
  expect(picker, label).not.toBeNull();
  await act(async () => {
    picker.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(picker, query);
    picker.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => picker.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  await act(async () => picker.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
}
const obatRow = (name: string) => [...host.querySelectorAll("tr")].find(tr => tr.querySelector("td")?.textContent === name)!;
const addObat = (name: string) => act(async () => obatRow(name).querySelector<HTMLButtonElement>('button[title="Tambah"]')!.click());
const cartCell = (name: string) => [...host.querySelectorAll("td")].find(td => td.querySelector("[data-cart-item]")?.textContent === name)!;
const stokIn = (scope: Element) => [...scope.querySelectorAll("[data-stok-klinik]")].map(el => `${el.getAttribute("data-stok-klinik")}|${el.textContent}`);

describe.each(["exam", "obat-khusus"] as const)("%s: daftar obat & keranjang", (kind) => {
  it("stok belum terbaca tampil 'belum terbaca', stok nol tampil 0", async () => {
    await render(kind);
    expect(stokIn(obatRow("Obat belum terbaca"))).toEqual(["belum-terbaca|stok belum terbaca"]);
    expect(obatRow("Obat belum terbaca").textContent).not.toMatch(/\b0 pcs/);
    expect(stokIn(obatRow("Obat habis"))).toEqual(["habis|stok 0 pcs"]);
    expect(stokIn(obatRow("Obat berkotak"))).toEqual(["cukup|stok 25 pcs"]);
  });

  it("keranjang: stok dikonversi ke satuan baris dan kekurangan terlihat sebelum simpan", async () => {
    await render(kind);
    await addObat("Obat berkotak");
    const cell = () => cartCell("Obat berkotak");
    expect(stokIn(cell())).toEqual(["cukup|stok 25 pcs"]);
    await setValue(cell().querySelector<HTMLSelectElement>('select[title="Satuan"]')!, "box");
    expect(stokIn(cell())).toEqual(["cukup|stok 2,5 box (25 pcs)"]);
    await setValue(host.querySelector<HTMLInputElement>('input[aria-label="Jumlah Obat berkotak"]')!, "3");
    expect(stokIn(cell())).toEqual(["kurang|stok 2,5 box (25 pcs) · kurang 0,5 box"]);
  });

  it("keranjang: obat dengan stok belum terbaca tidak ditulis 0 (dan tidak dinilai cukup)", async () => {
    await render(kind);
    await addObat("Obat belum terbaca");
    expect(stokIn(cartCell("Obat belum terbaca"))).toEqual(["belum-terbaca|stok belum terbaca"]);
  });

  it("tindakan persediaan ber-BMHP: stok bahannya yang tampil, bukan stok induk tindakan", async () => {
    await render(kind);
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === "Tindakan & Racikan")!.click());
    await click('button[aria-label="Pilih Operasi Steril"]');
    await pickFrom("Tambah BMHP Operasi Steril", "Kasa");
    await setValue(field('select[aria-label="Satuan BMHP Kasa steril"]')! as unknown as HTMLSelectElement, "pak");
    // Satuan BMHP pak (isi 10): stok 9 lembar = 0,9 pak, dan 1 pak berarti kurang.
    expect(host.textContent).toContain("stok 0,9 pak (9 lembar) · kurang 0,1 pak");
    await setValue(field('select[aria-label="Satuan BMHP Kasa steril"]')! as unknown as HTMLSelectElement, "lembar");
    await click('button[aria-label="Tambah Operasi Steril ke keranjang"]');
    const cell = cartCell("Operasi Steril");
    expect(stokIn(cell)).toEqual(["cukup|Kasa steril: stok 9 lembar"]);
    expect(cell.textContent).not.toContain("stok 0 pcs");
  });

  it("racikan di keranjang tidak menampilkan stok lagi (bahan tidak dikeluarkan dua kali saat ditagih)", async () => {
    await render(kind);
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === "Tindakan & Racikan")!.click());
    await click('button[aria-label="Pilih Obat Racik Sirup"]');
    await pickFrom("Tambah bahan Obat Racik Sirup", "Bahan");
    // Bahan racikan: stok belum terbaca juga tidak ditulis 0.
    expect(host.textContent).toContain("stok belum terbaca");
    await click('button[aria-label="Tambah Obat Racik Sirup ke keranjang"]');
    expect(stokIn(cartCell("Obat Racik Sirup"))).toEqual([]);
  });
});

it("OBAT KHUSUS: penjagaan sebelum simpan tidak dilonggarkan — stok belum terbaca tetap ditahan, tanpa angka 0", async () => {
  const { addInpatientBillables } = await import("@/app/(app)/klinik/rawat-inap/actions");
  vi.mocked(addInpatientBillables).mockClear();
  await render("obat-khusus");
  await addObat("Obat belum terbaca");
  await act(async () => host.querySelector("form")!.requestSubmit());
  expect(addInpatientBillables).not.toHaveBeenCalled();
  const dialog = document.querySelector('dialog[aria-modal="true"]')!;
  expect(dialog.textContent).toContain("Obat belum terbaca");
  expect(dialog.textContent).toContain("—");
  expect(dialog.textContent).not.toMatch(/\b0 pcs/);
});

it("Laporan Visit rawat inap tetap murni klinis: tidak ada katalog/stok", async () => {
  await render("laporan-visit");
  expect(host.querySelector("[data-stok-klinik]")).toBeNull();
  expect(host.textContent).not.toContain("DAFTAR OBAT");
});

describe("TindakanRacikanForm: label pemilih memakai teks stok bersama", () => {
  it("pilihan BMHP/bahan menyebut 'belum terbaca', bukan 'stok 0'", async () => {
    await act(async () => root.render(<TindakanRacikanForm<FormItem> tindakanItems={[operasi]} racikanItems={[]} bmhpItems={[unread]} bahanItems={[]}
      katalogRacikan={[]} bolehManual tindakan={{ item: operasi, bmhp: [], editKey: null }}
      racikan={{ saleItemId: "", formulaId: "", dosageForm: "sirup", instruction: "", ingredients: [] }} editing={false} harga={0}
      onPilihRacikan={() => {}} onUbahRacikan={() => {}} onBatal={() => {}} />));
    const picker = field('[aria-label="Tambah BMHP Operasi Steril"]')!;
    await act(async () => { picker.focus(); });
    expect(document.body.textContent).toContain("Obat belum terbaca (stok belum terbaca)");
    expect(document.body.textContent).not.toContain("Obat belum terbaca (stok null");
  });
});

describe("Pembayaran (ItemTable): baris tambahan kasir / susulan", () => {
  const master: MasterItem[] = [
    { id: "boxed", code: "B1", name: "Obat berkotak", unit: "pcs", harga: 1000, stokGudang: 25, units: [{ unit: "pcs", factor: 1, sell_price: 1000, buy_price: 0 }, { unit: "box", factor: 10, sell_price: 10000, buy_price: 0 }] },
    { id: "unread", code: "U1", name: "Obat belum terbaca", unit: "pcs", harga: 1000, stokGudang: null, units: [{ unit: "pcs", factor: 1, sell_price: 1000, buy_price: 0 }] },
  ];
  type Row = Parameters<typeof ItemTable>[0]["rows"][number];
  function Billing({ initial, list = master }: { initial: Row[]; list?: MasterItem[] }) {
    const [rows, setRows] = useState<Row[]>(initial);
    return <ItemTable title="OBAT" icon="ti-pill" color="#000" rows={rows} setRows={setRows} master={list} listId="t" allowUnits />;
  }
  const row = (i: number) => host.querySelectorAll("tbody tr")[i];

  it("baris kasir: stok gudang klinik dalam satuan baris, kekurangan terlihat", async () => {
    await act(async () => root.render(<Billing initial={[{ key: "a", deskripsi: "Obat berkotak", item_id: "boxed", qty: 1, harga: 1000, satuan: "pcs" }]} />));
    expect(stokIn(row(0))).toEqual(["cukup|stok 25 pcs"]);
    await setValue(host.querySelector<HTMLSelectElement>('select[aria-label="Satuan Obat berkotak"]')!, "box");
    await setValue(host.querySelector<HTMLInputElement>('input[aria-label="Jumlah Obat berkotak"]')!, "3");
    expect(stokIn(row(0))).toEqual(["kurang|stok 2,5 box (25 pcs) · kurang 0,5 box"]);
  });

  it("stok belum terbaca tampil 'belum terbaca', bukan 0", async () => {
    await act(async () => root.render(<Billing initial={[{ key: "a", deskripsi: "Obat belum terbaca", item_id: "unread", qty: 2, harga: 1000, satuan: "pcs" }]} />));
    expect(stokIn(row(0))).toEqual(["belum-terbaca|stok belum terbaca"]);
  });

  it("baris dari resep, racikan dan jasa tanpa stok tidak diberi angka stok yang menyesatkan", async () => {
    await act(async () => root.render(<Billing initial={[
      { key: "r", deskripsi: "Obat berkotak", item_id: "boxed", qty: 1, harga: 1000, satuan: "pcs", prescription_item_id: "rx-1" },
      { key: "c", deskripsi: "Racikan", item_id: null, qty: 1, harga: 5000, satuan: "racikan", recipe_id: "recipe" },
      { key: "j", deskripsi: "Konsultasi", item_id: "consult", qty: 1, harga: 5000, satuan: "kali" },
    ]} list={[...master, { id: "consult", code: "J1", name: "Konsultasi", unit: "kali", harga: 5000 }]} />));
    expect(host.querySelector("[data-stok-klinik]")).toBeNull();
  });
});
