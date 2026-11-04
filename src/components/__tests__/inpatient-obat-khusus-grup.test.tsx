// @vitest-environment jsdom
// BUG 1 — barang tipe Grup harus terbaca di input Rawat Inap "Obat Khusus".
// Paritas dengan Rekam Medis (RekamForm.tambahPaket): Grup dipilih dari daftar Obat → dipecah jadi baris isi
// (pecahPaket) + asal paket (paket_id/paket_qty) ikut terkirim; server meneruskannya ke RPC sebagai package_item_id/package_qty.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ addDailyLogPos: vi.fn(), addInpatientBillables: vi.fn() }));
import { CatatanForm } from "@/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm";
import { addInpatientBillables } from "@/app/(app)/klinik/rawat-inap/actions";
import type { ResepPaket } from "@/lib/paket-klinik";
const GROUP = "10000000-0000-4000-8000-000000000001", SPUIT = "10000000-0000-4000-8000-000000000002", JASA = "10000000-0000-4000-8000-000000000003";
const resep: ResepPaket = { id: GROUP, name: "Paket Steril", komponen: [
  { item_id: SPUIT, name: "Spuit", item_type: "Persediaan", base_unit: "pcs", qty: 2, unit: "pcs", factor: 1 },
  { item_id: JASA, name: "Jasa Steril", item_type: "Jasa", base_unit: "x", qty: 1, unit: "x", factor: 1 },
] };
const base = { requestKey: "k", draftUserId: "d", recordId: "stay", backHref: "/x",
  patient: { name: "F", species: "Kucing", breed: null, noRM: "F", owner: "F", phone: "", address: "", tglMasuk: "1 Nov", dokter: "F", kondisi: "Stabil", photo: null },
  items: [
    { id: GROUP, name: "Paket Steril", unit: "paket", sell_price: 300000, stok: 3, item_type: "Grup", units: [] },
    { id: SPUIT, name: "Spuit", unit: "pcs", sell_price: 5000, stok: 10, item_type: "Persediaan", units: [{ unit: "pcs", factor: 1, sell_price: 5000 }] },
  ],
  jasaItems: [{ id: JASA, name: "Jasa Steril", unit: "x", sell_price: 250000, stok: null, item_type: "Jasa" }],
  tindakanItems: [], bahanItems: [], racikanItems: [], katalogRacikan: [], bolehManual: false };
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("Grup di daftar Obat ranap dipecah jadi baris isi + asal paket (seperti Rekam Medis)", async () => {
  vi.mocked(addInpatientBillables).mockResolvedValue({ saved: true, href: "/x" });
  await act(async () => root.render(<CatatanForm {...props} />));
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Tambah"]')!.click()); // item pertama = Paket Steril
  await act(async () => host.querySelector("form")!.requestSubmit());
  expect(addInpatientBillables).toHaveBeenCalledOnce();
  const rows = JSON.parse(String(vi.mocked(addInpatientBillables).mock.calls[0][0].get("resep")));
  expect(rows.some((r: { item_id: string }) => r.item_id === GROUP), "Grup tidak boleh terkirim sebagai SKU biasa").toBe(false);
  expect(rows.map((r: { item_id: string }) => r.item_id).sort()).toEqual([JASA, SPUIT].sort());
  expect(rows.every((r: { paket_id?: string; paket_qty?: number }) => r.paket_id === GROUP && r.paket_qty === 1)).toBe(true);
});

const props = { ...base, mode: "billables" as const, paketResep: { [GROUP]: resep } } as React.ComponentProps<typeof CatatanForm>;
const kirim = async () => { await act(async () => host.querySelector("form")!.requestSubmit()); };
const rowsTerkirim = () => JSON.parse(String(vi.mocked(addInpatientBillables).mock.calls[0][0].get("resep"))) as
  { item_id: string; qty: number; jenis: string; paket_id?: string; paket_qty?: number }[];

it("memilih Grup dua kali = jumlah paket 2: qty isi dan paket_qty ikut, bukan baris baru", async () => {
  vi.mocked(addInpatientBillables).mockResolvedValue({ saved: true, href: "/x" });
  await act(async () => root.render(<CatatanForm {...props} />));
  const tambah = () => act(async () => host.querySelector<HTMLButtonElement>('button[title="Tambah"]')!.click());
  await tambah(); await tambah();
  expect(host.querySelectorAll("tr[data-paket]").length).toBe(1);
  expect(host.textContent).toContain("Paket Steril");
  expect(host.textContent).toContain("ISI PAKET");
  await kirim();
  const rows = rowsTerkirim();
  expect(rows).toHaveLength(2);
  expect(rows.find(r => r.item_id === SPUIT)).toMatchObject({ qty: 4, paket_id: GROUP, paket_qty: 2, jenis: "obat" });
  expect(rows.find(r => r.item_id === JASA)).toMatchObject({ qty: 2, paket_id: GROUP, paket_qty: 2, jenis: "jasa" });
});

it("Grup tidak mengganggu obat biasa yang sama dengan isinya, dan hapus paket menghapus seluruh isinya", async () => {
  vi.mocked(addInpatientBillables).mockResolvedValue({ saved: true, href: "/x" });
  await act(async () => root.render(<CatatanForm {...props} />));
  const tombol = (nama: string) => [...host.querySelectorAll<HTMLTableRowElement>("tbody tr")].find(tr => tr.textContent?.startsWith(nama))!
    .querySelector<HTMLButtonElement>('button[title="Tambah"]')!;
  await act(async () => tombol("Spuit").click());   // obat biasa
  await act(async () => tombol("Paket Steril").click()); // lalu paket berisi spuit yang sama
  await act(async () => tombol("Spuit").click());   // obat biasa lagi: hanya baris biasa yang bertambah
  await kirim();
  const rows = rowsTerkirim();
  const biasa = rows.find(r => r.item_id === SPUIT && !r.paket_id)!;
  const isiPaket = rows.find(r => r.item_id === SPUIT && r.paket_id)!;
  expect(biasa.qty).toBe(2);
  expect(isiPaket).toMatchObject({ qty: 2, paket_qty: 1, paket_id: GROUP });
  expect(rows.find(r => r.item_id === JASA)).toMatchObject({ qty: 1, paket_id: GROUP });
  expect(rows.some(r => r.item_id === GROUP)).toBe(false);

  vi.mocked(addInpatientBillables).mockClear();
  await act(async () => host.querySelector<HTMLElement>('[aria-label="Hapus paket Paket Steril"]')!.click());
  expect(host.querySelector("tr[data-paket]")).toBeNull();
  await kirim();
  expect(rowsTerkirim().map(r => `${r.item_id}:${r.qty}:${r.paket_id ?? "-"}`)).toEqual([`${SPUIT}:2:-`]);
});

it("stok isi paket diperiksa di keranjang: paket melebihi stok isi tidak terkirim", async () => {
  await act(async () => root.render(<CatatanForm {...props} items={[base.items[0], { ...base.items[1], stok: 3 }]} />));
  const tambah = () => act(async () => host.querySelector<HTMLButtonElement>('button[title="Tambah"]')!.click());
  await tambah(); await tambah(); // 2 paket x 2 spuit = 4 > stok spuit 3
  await kirim();
  expect(addInpatientBillables).not.toHaveBeenCalled();
});

it("Grup yang resepnya tidak terbaca tidak pernah masuk keranjang sebagai SKU biasa", async () => {
  await act(async () => root.render(<CatatanForm {...props} paketResep={{}} />));
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Tambah"]')!.click());
  expect(host.textContent).toContain("belum terbaca");
  await kirim();
  // Keranjang tetap kosong: Grup tidak ikut terkirim sebagai SKU biasa.
  expect(addInpatientBillables).toHaveBeenCalledOnce();
  expect(rowsTerkirim()).toEqual([]);
});

it("Grup bukan kandidat BMHP/bahan di tab Tindakan & Racikan", async () => {
  await act(async () => root.render(<CatatanForm {...props} />));
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === "Tindakan & Racikan")!.click());
  expect(host.innerHTML).not.toContain("Paket Steril");
});
