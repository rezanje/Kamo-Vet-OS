// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { bacaShopeeXlsx } from "@/lib/shopee-import";
import type { CatalogItem } from "@/lib/shopee-import-match";

const mocks = vi.hoisted(() => ({ pratinjau: vi.fn(), simpan: vi.fn() }));
vi.mock("@/app/(app)/penjualan/online/impor/actions", () => ({ pratinjauImporShopee: mocks.pratinjau, simpanImporShopee: mocks.simpan }));
import { ShopeeImportWorkspace } from "@/app/(app)/penjualan/online/impor/ShopeeImportWorkspace";

const FIXTURE = join(__dirname, "../../lib/__tests__/fixtures/shopee-order-toship-sample.xlsx");
const WH_PUSAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", WH_PANDU = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const JIO = "11111111-1111-4111-8111-111111111111", DIG = "22222222-2222-4222-8222-222222222222", HAIR = "33333333-3333-4333-8333-333333333333";
const O1 = "2611050FIKTIF1", O2 = "2611050FIKTIF2", O3 = "2611050FIKTIF3";
const CATALOG: CatalogItem[] = [
  { id: JIO, code: "JIO-500", name: "Jio Dryfood 500gr", sell_price: 16500, stock: 1 },
  { id: DIG, code: "MRV-DIG", name: "Mr.Vet Digestion Care T1 1kg", sell_price: 80000, stock: 5 },
  { id: HAIR, code: "MRV-HAIR", name: "Mr.Vet Hair & Skin Care T2 1kg", sell_price: 80000, stock: 5 },
];
const WAREHOUSES = [{ id: WH_PUSAT, name: "Online Pusat", branch_name: "Kamo Pusat" }, { id: WH_PANDU, name: "Online Panduraya", branch_name: "Kamo Panduraya" }];

async function mount(props: Partial<React.ComponentProps<typeof ShopeeImportWorkspace>> = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const c = document.createElement("div");
  document.body.append(c);
  const root = createRoot(c);
  await act(async () => root.render(<ShopeeImportWorkspace warehouses={WAREHOUSES} defaultWarehouseId={WH_PANDU} isOwner={false} {...props} />));
  return { c, dispose: async () => { await act(async () => root.unmount()); c.remove(); } };
}
const sel = (c: HTMLElement, q: string) => c.querySelector<HTMLElement>(q)!;
async function pilihFile(c: HTMLElement) {
  const input = sel(c, 'input[type="file"]') as HTMLInputElement;
  const f = new File([readFileSync(FIXTURE)], "Order.toship.xlsx");
  await act(async () => { Object.defineProperty(input, "files", { value: [f], configurable: true }); input.dispatchEvent(new Event("change", { bubbles: true })); });
}
const klik = async (el: HTMLElement) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const tombol = (c: HTMLElement, teks: RegExp) => [...c.querySelectorAll<HTMLButtonElement>("button")].find(b => teks.test(b.textContent ?? ""))!;

beforeEach(async () => {
  mocks.pratinjau.mockReset(); mocks.simpan.mockReset();
  const { orders } = await bacaShopeeXlsx(readFileSync(FIXTURE));
  mocks.pratinjau.mockResolvedValue({ orders, catalog: CATALOG, existing: {} });
});

it("gudang bawaan = satu-satunya gudang cabang Panduraya; tanpa bawaan pengguna wajib memilih", async () => {
  const a = await mount();
  expect((sel(a.c, 'select[aria-label="Gudang online"]') as HTMLSelectElement).value).toBe(WH_PANDU);
  await a.dispose();
  const b = await mount({ defaultWarehouseId: "" });
  expect((sel(b.c, 'select[aria-label="Gudang online"]') as HTMLSelectElement).value).toBe("");
  await pilihFile(b.c);
  await klik(tombol(b.c, /pratinjau/i));
  expect(mocks.pratinjau).not.toHaveBeenCalled();
  expect(b.c.textContent).toMatch(/pilih gudang/i);
  await b.dispose();
});

it("pratinjau per pesanan: barang cocok, qty, harga yang dibebankan, peringatan, dan alasan pesanan dilewati", async () => {
  const { c, dispose } = await mount();
  await pilihFile(c);
  await klik(tombol(c, /pratinjau/i));
  const fd = mocks.pratinjau.mock.calls[0][0] as FormData;
  expect(fd.get("warehouse_id")).toBe(WH_PANDU);
  expect((fd.get("file") as File).name).toBe("Order.toship.xlsx");

  expect([...c.querySelectorAll("[data-order]")].map(e => [e.getAttribute("data-order"), e.getAttribute("data-status")])).toEqual([
    [O1, "dilewati"], [O2, "perlu-perbaikan"], [O3, "perlu-perbaikan"],
  ]);
  expect(sel(c, `[data-order="${O1}"]`).textContent).toMatch(/Pembatalan diajukan/);
  const o2 = sel(c, `[data-order="${O2}"]`).textContent!;
  expect(o2).toContain("Jio Dryfood 500gr");           // barang master terpilih
  expect(o2).toContain("16.349");                       // harga setelah diskon
  expect(o2).toMatch(/Stok gudang 1/);                  // qty 2 > stok 1
  expect(o2).toMatch(/1\.037/);                         // selisih Total Pembayaran dijelaskan
  expect(o2).toMatch(/pembeli_fiktif_2/);
  const o3 = sel(c, `[data-order="${O3}"]`).textContent!;
  expect(o3).toContain("Mr.Vet Digestion Care T1 1kg");
  expect(o3).toContain("Mr.Vet Hair & Skin Care T2 1kg");
  expect(o3).toContain("78.663");
  expect(o3).toMatch(/2\.300/);
  expect((tombol(c, /simpan semua/i)).disabled).toBe(true);
  await dispose();
});

it("Simpan semua aktif setelah perkiraan dikonfirmasi; mengirim hanya pesanan siap (bukan yang dibatalkan) dan menampilkan hasil per pesanan", async () => {
  mocks.simpan.mockResolvedValue({ ok: false, results: [
    { orderNo: O2, status: "ok", message: "Tersimpan sebagai ONL-20261105-0001.", documentNo: "ONL-20261105-0001" },
    { orderNo: O3, status: "error", message: "Stok tidak cukup" },
  ] });
  const { c, dispose } = await mount();
  await pilihFile(c); await klik(tombol(c, /pratinjau/i));
  for (const q of [`${O2} baris 1`, `${O3} baris 1`, `${O3} baris 2`]) await klik(sel(c, `input[aria-label="Konfirmasi kecocokan ${q}"]`));
  const simpan = tombol(c, /simpan semua/i);
  expect(simpan.disabled).toBe(false);
  expect(simpan.textContent).toMatch(/2 pesanan/);
  await klik(simpan);
  expect(mocks.simpan).toHaveBeenCalledTimes(1);
  const fd = mocks.simpan.mock.calls[0][0] as FormData;
  expect(fd.get("warehouse_id")).toBe(WH_PANDU);
  expect(JSON.parse(String(fd.get("selection")))).toEqual([{ orderNo: O2, items: [JIO] }, { orderNo: O3, items: [DIG, HAIR] }]);
  expect(sel(c, `[data-result="${O2}"]`).textContent).toMatch(/ONL-20261105-0001/);
  expect(sel(c, `[data-result="${O3}"]`).textContent).toMatch(/Stok tidak cukup/);
  expect(sel(c, `[data-result="${O1}"]`)).toBeNull();
  await dispose();
});

it("klik ganda Simpan semua hanya mengirim satu permintaan", async () => {
  let selesai!: (v: unknown) => void;
  mocks.simpan.mockReturnValue(new Promise(r => { selesai = r; }));
  const { c, dispose } = await mount();
  await pilihFile(c); await klik(tombol(c, /pratinjau/i));
  for (const q of [`${O2} baris 1`, `${O3} baris 1`, `${O3} baris 2`]) await klik(sel(c, `input[aria-label="Konfirmasi kecocokan ${q}"]`));
  const simpan = tombol(c, /simpan semua/i);
  await klik(simpan); await klik(simpan);
  expect(mocks.simpan).toHaveBeenCalledTimes(1);
  await act(async () => selesai({ ok: true, results: [{ orderNo: O2, status: "ok", message: "ok", documentNo: "ONL-1" }, { orderNo: O3, status: "ok", message: "ok", documentNo: "ONL-2" }] }));
  // setelah sukses, pesanan tampil 'sudah diimpor' dan tidak bisa dikirim ulang
  expect(tombol(c, /simpan semua/i).disabled).toBe(true);
  expect(sel(c, `[data-order="${O2}"]`).getAttribute("data-status")).toBe("duplikat");
  await dispose();
});

it("file yang sama diunggah lagi: semua pesanan 'sudah diimpor' dan tidak ada yang bisa disimpan", async () => {
  const { orders } = await bacaShopeeXlsx(readFileSync(FIXTURE));
  mocks.pratinjau.mockResolvedValue({ orders, catalog: CATALOG, existing: {
    [O2]: { noStruk: "ONL-20261105-0001", voided: false }, [O3]: { noStruk: "ONL-20261105-0002", voided: false },
  } });
  const { c, dispose } = await mount();
  await pilihFile(c); await klik(tombol(c, /pratinjau/i));
  expect([...c.querySelectorAll("[data-order]")].map(e => e.getAttribute("data-status"))).toEqual(["dilewati", "duplikat", "duplikat"]);
  expect(sel(c, `[data-order="${O2}"]`).textContent).toMatch(/sudah diimpor/i);
  expect(tombol(c, /simpan semua/i).disabled).toBe(true);
  await dispose();
});

it("pilihan barang manual lewat dropdown menyelesaikan pesanan; pesanan Owner-only 'Sertakan' hanya untuk Owner", async () => {
  mocks.pratinjau.mockResolvedValue({ orders: (await bacaShopeeXlsx(readFileSync(FIXTURE))).orders, catalog: [CATALOG[1], CATALOG[2]], existing: {} });
  const staff = await mount();
  await pilihFile(staff.c); await klik(tombol(staff.c, /pratinjau/i));
  expect(staff.c.querySelector(`input[aria-label="Sertakan ${O1}"]`)).toBeNull();
  // Jio tidak ada di katalog -> blok sampai dipilih manual
  expect(sel(staff.c, `[data-order="${O2}"]`).textContent).toMatch(/Belum cocok/);
  await staff.dispose();
  const owner = await mount({ isOwner: true });
  await pilihFile(owner.c); await klik(tombol(owner.c, /pratinjau/i));
  expect(owner.c.querySelector(`input[aria-label="Sertakan ${O1}"]`)).not.toBeNull();
  await owner.dispose();
});

it("galat pratinjau ditampilkan dan tidak ada tabel", async () => {
  mocks.pratinjau.mockResolvedValue({ error: "Kolom wajib tidak ditemukan: Jumlah.", orders: [], catalog: [], existing: {} });
  const { c, dispose } = await mount();
  await pilihFile(c); await klik(tombol(c, /pratinjau/i));
  expect(c.textContent).toMatch(/Kolom wajib tidak ditemukan/);
  expect(c.querySelector("[data-order]")).toBeNull();
  await dispose();
});
