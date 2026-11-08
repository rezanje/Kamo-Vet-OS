// @vitest-environment jsdom
// Andri 7 Nov 2026: Injeksi Antibiotik tidak bisa diproses karena HPP > harga; Owner mau Lacto-B jadi 3,4.
// Kontrol "Ubah BMHP (Owner)" hanya muncul untuk Owner pada baris tindakan ber-BMHP di keranjang kasir rawat inap;
// layar hanya mengirim pilihan, database menegakkan peran, batas, snapshot, dan lantai HPP (P03 tidak disentuh).
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const aksi = vi.hoisted(() => ({
  pratinjau: vi.fn(async (f: FormData) => (void f, ({ ok: true as const, pratinjau: { hpp_before: 60000, hpp_after: 40800, price: 50000, floor_applies: true, price_below_hpp_before: true, price_below_hpp_after: false, can_post_after: true } }))),
  simpan: vi.fn(async (f: FormData) => (void f, ({ ok: true as const, pratinjau: { hpp_before: 60000, hpp_after: 40800, price: 50000, floor_applies: true, price_below_hpp_before: true, price_below_hpp_after: false } }))),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/bmhp-owner-actions", () => ({ pratinjauBmhp: aksi.pratinjau, simpanBmhp: aksi.simpan }));
import { InpatientCashier } from "@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier";
import type { InpatientCashierData, InpatientCashierRow } from "@/lib/inpatient-cashier";

const LAC = "10000000-0000-4000-8000-000000000001"; const PROC = "10000000-0000-4000-8000-000000000002"; const EXTRA = "10000000-0000-4000-8000-000000000003";
const masterObat = [{ id: LAC, name: "Lacto-B Fiktif", code: "LB", unit: "ml", harga: 1000 }, { id: EXTRA, name: "Bahan Lain Fiktif", code: "BL", unit: "pcs", harga: 500 }, { id: "pk", name: "Paket Fiktif", code: "PK", unit: "paket", harga: 1, paket: true }];
const masterJasa = [{ id: PROC, name: "Injeksi Antibiotik Fiktif", code: "IA", unit: "kali", harga: 50000 }];
const patient = { photo: null, name: "Pasien Fiktif", species: "Kucing", owner: "Pemilik Fiktif", phone: "", address: "", dokter: "drh. Fiktif", jenisLayanan: "Rawat Inap", noInvoice: "(baru)", tanggal: "01/11/2026" };
const data: InpatientCashierData = { tax_settings: { mode_pkp: false, ppn_rate: 0 }, snapshot: "snapshot-keranjang-1", rows: [], history: [], receipts: [], applications: [], quote: { token: "q", remaining: 0, pending: 0, debt: 0, credit: 0, subtotal: 0, tax: 0, total: 0, accounts: [] } as never };
const bmhp = [{ item_id: LAC, name: "Lacto-B Fiktif", qty: 5, unit: null, factor: 1, base_qty: 5 }];
const jasa = (over: Partial<InpatientCashierRow> = {}): InpatientCashierRow => ({ id: "rx-1", item_id: PROC, nama_obat: "Injeksi Antibiotik Fiktif", qty: 1, harga: 50000, satuan: "kali", jenis: "jasa", bmhp_components: bmhp, ...over });
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); aksi.pratinjau.mockClear(); aksi.simpan.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(rows: InpatientCashierRow[], owner: boolean) {
  await act(async () => root.render(<InpatientCashier data={{ ...data, rows }} patient={patient} visitId="visit-1" recordId="stay-1" requestKey="key" masterObat={masterObat} masterJasa={masterJasa} ppnRate={0} minDpPercent={50} bolehTerobos={false} bolehUbahBmhp={owner} />));
}
const tombol = (teks: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(teks)) as HTMLButtonElement | undefined;
const klik = async (el: HTMLElement) => act(async () => { el.click(); });
const ketik = async (el: HTMLInputElement | HTMLSelectElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
});

it("bukan Owner: kontrol tidak ada sama sekali", async () => { await render([jasa()], false); expect(tombol("Ubah BMHP (Owner)")).toBeUndefined(); expect(host.textContent).not.toContain("BMHP"); });
it("Owner: baris tindakan ber-BMHP punya tombol; baris tanpa BMHP dan racikan tidak", async () => {
  await render([jasa(), jasa({ id: "rx-2", bmhp_components: undefined }), jasa({ id: "rx-3", compound_recipe_id: "r1" }), jasa({ id: "rx-4", bmhp_components: [] })], true);
  expect(host.querySelectorAll("[data-bmhp-owner-row]").length).toBe(1);
  expect(host.querySelector("[data-bmhp-owner-row]")!.getAttribute("data-bmhp-owner-row")).toBe("rx-1");
  expect(tombol("Ubah BMHP (Owner)")).toBeDefined();
});
it("Owner mengubah Lacto-B 5 -> 3,4: pratinjau mengirim snapshot keranjang, baris resep, jumlah; simpan butuh pratinjau dan alasan >= 5 huruf", async () => {
  await render([jasa()], true);
  await klik(tombol("Ubah BMHP (Owner)")!);
  const qty = host.querySelector<HTMLInputElement>('input[aria-label="Jumlah Lacto-B Fiktif"]')!;
  expect(qty.value).toBe("5");
  await ketik(qty, "3.4");
  expect(tombol("Simpan perubahan BMHP")!.disabled).toBe(true);
  await klik(tombol("Pratinjau")!);
  const f = aksi.pratinjau.mock.calls[0][0];
  expect(f.get("mode")).toBe("pending"); expect(f.get("visit_id")).toBe("visit-1"); expect(f.get("record_id")).toBe("stay-1"); expect(f.get("target_id")).toBe("rx-1"); expect(f.get("snapshot")).toBe("snapshot-keranjang-1");
  expect(JSON.parse(String(f.get("components")))).toEqual([{ item_id: LAC, qty: "3.4", unit: null }]);
  expect(host.textContent).toContain("belum ada yang berubah");
  expect(host.textContent).toContain("batas harga lolos");
  expect(tombol("Simpan perubahan BMHP")!.disabled).toBe(true); // alasan belum diisi
  await ketik(host.querySelector<HTMLInputElement>("input#alasan-rx-1")!, "abc");
  expect(tombol("Simpan perubahan BMHP")!.disabled).toBe(true);
  await ketik(host.querySelector<HTMLInputElement>("input#alasan-rx-1")!, "Lacto-B 3,4 sesuai pemakaian");
  expect(tombol("Simpan perubahan BMHP")!.disabled).toBe(false);
  await klik(tombol("Simpan perubahan BMHP")!);
  expect(aksi.simpan).toHaveBeenCalledTimes(1);
  expect(aksi.simpan.mock.calls[0][0].get("reason")).toBe("Lacto-B 3,4 sesuai pemakaian");
  expect(String(aksi.simpan.mock.calls[0][0].get("request_key")).length).toBeGreaterThan(8);
  expect(host.textContent).toContain("sudah diubah");
});
it("mengubah daftar setelah pratinjau membatalkan pratinjau (simpan terkunci lagi)", async () => {
  await render([jasa()], true);
  await klik(tombol("Ubah BMHP (Owner)")!);
  await ketik(host.querySelector<HTMLInputElement>("input#alasan-rx-1")!, "Alasan cukup panjang");
  await klik(tombol("Pratinjau")!);
  expect(tombol("Simpan perubahan BMHP")!.disabled).toBe(false);
  await ketik(host.querySelector<HTMLInputElement>('input[aria-label="Jumlah Lacto-B Fiktif"]')!, "2");
  expect(tombol("Simpan perubahan BMHP")!.disabled).toBe(true);
});
it("jumlah tidak valid atau semua bahan dikeluarkan: pratinjau terkunci dengan pesan", async () => {
  await render([jasa()], true);
  await klik(tombol("Ubah BMHP (Owner)")!);
  const qty = host.querySelector<HTMLInputElement>('input[aria-label="Jumlah Lacto-B Fiktif"]')!;
  await ketik(qty, "-2"); expect(tombol("Pratinjau")!.disabled).toBe(true); expect(host.textContent).toContain("angka positif");
  await ketik(qty, ""); expect(tombol("Pratinjau")!.disabled).toBe(true); expect(host.textContent).toContain("Minimal satu bahan");
  await ketik(qty, "1.00001"); expect(tombol("Pratinjau")!.disabled).toBe(true);
});
it("bahan lain bisa ditambah dari master (bukan paket), tidak dua kali", async () => {
  await render([jasa()], true);
  await klik(tombol("Ubah BMHP (Owner)")!);
  const pilih = host.querySelector<HTMLSelectElement>('select[aria-label="Tambah bahan"]')!;
  expect([...pilih.options].map((o) => o.textContent)).toEqual(["Tambah bahan lain…", "Bahan Lain Fiktif (pcs)"]); // Lacto-B sudah ada, paket tidak ditawarkan
  await ketik(pilih, EXTRA); await klik([...host.querySelectorAll("button")].find((b) => b.textContent === "Tambah")!);
  expect(host.querySelector('input[aria-label="Jumlah Bahan Lain Fiktif"]')).not.toBeNull();
  await klik(tombol("Pratinjau")!);
  expect(JSON.parse(String(aksi.pratinjau.mock.calls[0][0].get("components")))).toEqual([{ item_id: LAC, qty: "5", unit: null }, { item_id: EXTRA, qty: "1", unit: null }]);
});
it("harga masih di bawah HPP baru: peringatan, simpan terkunci (kasir tetap akan menolak)", async () => {
  aksi.pratinjau.mockResolvedValueOnce({ ok: true, pratinjau: { hpp_before: 60000, hpp_after: 55000, price: 50000, floor_applies: true, price_below_hpp_before: true, price_below_hpp_after: true, can_post_after: false } });
  await render([jasa()], true);
  await klik(tombol("Ubah BMHP (Owner)")!);
  await ketik(host.querySelector<HTMLInputElement>('input[aria-label="Jumlah Lacto-B Fiktif"]')!, "4.6");
  await ketik(host.querySelector<HTMLInputElement>("input#alasan-rx-1")!, "Alasan cukup panjang");
  await klik(tombol("Pratinjau")!);
  expect(host.textContent).toContain("kasir tetap akan menolak");
  expect(tombol("Simpan perubahan BMHP")!.disabled).toBe(true);
});
it("galat dari database ditampilkan sebagai kalimat sederhana dan tidak menutup form", async () => {
  aksi.simpan.mockResolvedValueOnce({ ok: false, pesan: "Keranjang sudah berubah sejak halaman dibuka. Muat ulang halaman lalu ulangi." } as never);
  await render([jasa()], true);
  await klik(tombol("Ubah BMHP (Owner)")!);
  await ketik(host.querySelector<HTMLInputElement>('input[aria-label="Jumlah Lacto-B Fiktif"]')!, "3");
  await ketik(host.querySelector<HTMLInputElement>("input#alasan-rx-1")!, "Alasan cukup panjang");
  await klik(tombol("Pratinjau")!); await klik(tombol("Simpan perubahan BMHP")!);
  expect(host.textContent).toContain("Muat ulang halaman");
  expect(tombol("Simpan perubahan BMHP")).toBeDefined();
});
it("payload simpan keranjang kasir TIDAK membawa bmhp_components (kasir tidak pernah menulis BMHP)", async () => {
  await render([jasa()], true);
  const rows = JSON.parse(host.querySelector<HTMLInputElement>('input[name="pending_rows"]')!.value);
  expect(rows).toHaveLength(1);
  expect(Object.keys(rows[0])).not.toContain("bmhp_components");
});
