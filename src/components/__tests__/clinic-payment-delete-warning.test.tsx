// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Andri 29 Okt ("OK peringatan hapus"): menghapus baris resep/racikan di pembayaran klinik
// membuat item itu tidak pernah tertagih lagi (1 kunjungan = 1 tagihan; bahan racikan
// sudah keluar saat diracik). Kasir harus diperingatkan dulu; baris ketikan kasir sendiri
// tetap langsung terhapus.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
import { ItemTable } from "@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";

type Row = Parameters<typeof ItemTable>[0]["rows"][number];
const resep: Row = { key: "r1", deskripsi: "Amoxicillin", qty: 1, harga: 10000, item_id: "amox", prescription_item_id: "p1" } as Row;
const racikan: Row = { key: "r2", deskripsi: "Racik kapsul AB", qty: 1, harga: 50000, item_id: "rk", recipe_id: "rec1", satuan: "racikan" } as Row;
const manual: Row = { key: "r3", deskripsi: "Shampoo", qty: 1, harga: 20000, item_id: "sh" } as Row;

let host: HTMLDivElement; let root: Root; let latest: Row[] = [];
function Harness({ awal }: { awal: Row[] }) {
  const [rows, setRows] = useState(awal);
  return <ItemTable title="Obat" icon="ti-pill" color="#000" rows={rows} setRows={(r) => { setRows(r); latest = r; }} master={[]} listId="x" />;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const hapus = (i: number) => host.querySelectorAll<HTMLElement>('[aria-label^="Hapus baris"]')[i];
const dialog = () => host.querySelector<HTMLDialogElement>('dialog[aria-label="Hapus item tagihan"]');
const tombol = (teks: string) => [...dialog()!.querySelectorAll("button")].find(b => b.textContent?.includes(teks))!;

beforeEach(() => { latest = []; });
it("baris dari resep: muncul peringatan, belum terhapus", async () => {
  latest = [resep, manual]; await act(async () => root.render(<Harness awal={[resep, manual]} />));
  await act(async () => hapus(0).click());
  expect(latest).toHaveLength(2);
  expect(dialog()?.textContent).toContain("tidak bisa ditagih lagi");
  expect(dialog()?.textContent).toContain("DP");
});

it("racikan: peringatan menyebut bahan sudah keluar dari stok", async () => {
  latest = [racikan]; await act(async () => root.render(<Harness awal={[racikan]} />));
  await act(async () => hapus(0).click());
  expect(dialog()?.textContent).toContain("Bahan racikan sudah keluar dari stok");
});

it("Batal mempertahankan baris; Tetap hapus menghapusnya", async () => {
  latest = [resep, manual]; await act(async () => root.render(<Harness awal={[resep, manual]} />));
  await act(async () => hapus(0).click());
  await act(async () => tombol("Batal").click());
  expect(latest).toHaveLength(2);
  expect(dialog()).toBeNull();
  await act(async () => hapus(0).click());
  await act(async () => tombol("Tetap hapus").click());
  expect(latest.map(r => r.key)).toEqual(["r3"]);
});

it("baris yang ditambah kasir sendiri langsung terhapus tanpa peringatan", async () => {
  latest = [resep, manual]; await act(async () => root.render(<Harness awal={[resep, manual]} />));
  await act(async () => hapus(1).click());
  expect(dialog()).toBeNull();
  expect(latest.map(r => r.key)).toEqual(["r1"]);
});
