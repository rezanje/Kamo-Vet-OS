// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ kirim: vi.fn(), terima: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/pos/pemindahan/actions", () => ({ buatKirim: fixture.kirim, terimaBarang: fixture.terima }));

import { PemindahanForm } from "@/app/(app)/pos/pemindahan/baru/PemindahanForm";
import { TerimaForm } from "@/app/(app)/pos/pemindahan/[id]/TerimaForm";

// Laporan Andri 17 Nov 2026: draf yang dipulihkan membawa kunci simpan dokumen yang sudah tersimpan.
const warehouses = [{ id: "a", name: "DC VET CMGG" }, { id: "b", name: "WH VET CMGG" }];
const units = [{ unit: "PCS", factor: 1, buy_price: 100, sell_price: 200 }];
const items = [{ id: "item", code: "ALK-00205", name: "Hematologi Hm5", unit: "PCS", buy_price: 100, units }];
const stock = [{ id: "s1", warehouse_id: "a", item_id: "item", qty: 122 }];
const DRAFT = "vetos:transaction-draft:v1:u1:transaction:pos:pemindahan:baru";
const STALE_KEY = "kunci-dokumen-397";
const REJECT = { ok: false, outcome: "rejected", code: "stale_request_key", message: "Kunci simpan lama sudah dipakai dokumen lain. Pemindahan ini BELUM tersimpan. Kunci sudah diganti otomatis; periksa isian lalu tekan Simpan sekali lagi." };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const keyOf = () => host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
const seedStaleDraft = () => sessionStorage.setItem(DRAFT, JSON.stringify({ version: 1, savedAt: Date.now(), requestKey: "draf-1", fields: { from_warehouse_id: "a" },
  snapshot: { rows: [{ display: "Hematologi Hm5", item_id: "item", qty: 22, satuan: "PCS" }], requestKey: STALE_KEY, warehouseId: "a" } }));
const render = (node = <PemindahanForm userId="u1" warehouses={warehouses} items={items} stock={stock} />) => act(async () => root.render(node));
const submit = () => act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const keysSent = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.map(call => (call[0] as FormData).get("request_key"));

it("draf dipulihkan: isian kembali tetapi kunci simpan BARU, bukan kunci dari draf", async () => {
  seedStaleDraft();
  await render();
  expect(host.textContent).toContain("Draf dipulihkan");
  expect(host.querySelector<HTMLSelectElement>('select[name="from_warehouse_id"]')!.value).toBe("a");
  expect(JSON.parse(host.querySelector<HTMLInputElement>('input[name="items"]')!.value)).toEqual([{ item_id: "item", qty: 22, satuan: "PCS" }]);
  expect(keyOf()).toBeTruthy();
  expect(keyOf()).not.toBe(STALE_KEY);
  await submit();
  expect(keysSent(fixture.kirim)).toEqual([keyOf()]);
  expect(keysSent(fixture.kirim)[0]).not.toBe(STALE_KEY);
});

it("kunci simpan tidak pernah ikut tersimpan di draf browser", async () => {
  await render();
  await act(async () => { const select = host.querySelector<HTMLSelectElement>('select[name="from_warehouse_id"]')!; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "a"); select.dispatchEvent(new Event("change", { bubbles: true })); });
  const saved = JSON.parse(sessionStorage.getItem(DRAFT)!);
  expect(saved.snapshot).toEqual({ rows: expect.any(Array), warehouseId: "a" });
  expect(saved.snapshot).not.toHaveProperty("requestKey");
  expect(sessionStorage.getItem(DRAFT)).not.toContain(keyOf());
});

it("kunci stabil antar render dan antara simpan pertama dan percobaan ulang (jaringan putus)", async () => {
  fixture.kirim.mockRejectedValueOnce(Error("network")).mockResolvedValueOnce(undefined);
  await render();
  const first = keyOf();
  await render();
  expect(keyOf()).toBe(first);
  await submit();
  expect(host.textContent).toContain("Respons simpan belum terkonfirmasi");
  expect(keyOf()).toBe(first);
  await submit();
  expect(keysSent(fixture.kirim)).toEqual([first, first]);
});

it("ditolak 'kunci dipakai' tanpa percobaan sebelumnya: pesan jelas, isian tetap, kunci diganti, tekan lagi memakai kunci baru", async () => {
  seedStaleDraft();
  fixture.kirim.mockResolvedValueOnce(REJECT).mockResolvedValueOnce(undefined);
  await render();
  const before = keyOf();
  await submit();
  expect(host.textContent).toContain("BELUM tersimpan");
  expect(host.textContent).not.toContain("Respons simpan belum terkonfirmasi");
  expect(keyOf()).not.toBe(before);
  expect(host.querySelector<HTMLSelectElement>('select[name="from_warehouse_id"]')!.value).toBe("a");
  expect(JSON.parse(host.querySelector<HTMLInputElement>('input[name="items"]')!.value)).toHaveLength(1);
  const after = keyOf();
  await submit();
  expect(keysSent(fixture.kirim)).toEqual([before, after]);
});

it("percobaan sebelumnya belum jelas lalu ditolak: JANGAN ganti kunci diam-diam (bisa tersimpan dobel); peringatkan dulu", async () => {
  fixture.kirim.mockRejectedValueOnce(Error("network")).mockResolvedValueOnce(REJECT).mockResolvedValueOnce(REJECT);
  await render();
  const first = keyOf();
  await submit();
  await submit();
  expect(keyOf()).toBe(first);
  expect(host.textContent).toContain("mungkin SUDAH tersimpan");
  await submit();
  expect(keyOf()).not.toBe(first);
  expect(keysSent(fixture.kirim)).toEqual([first, first, first]);
});

it("kunci diganti setelah simpan terkonfirmasi (reset draf) dan draf dibersihkan", async () => {
  await render();
  const before = keyOf();
  const draftKey = host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value;
  await act(async () => { window.dispatchEvent(new CustomEvent("vetos:transaction-confirmed", { detail: { scope: "pos:pemindahan:baru", key: draftKey } })); });
  expect(keyOf()).not.toBe(before);
  expect(sessionStorage.getItem(DRAFT)).toBeNull();
});

it("Terima Barang: draf lama dengan kunci basi juga tidak memakai ulang kunci itu, dan penolakan mengganti kunci", async () => {
  sessionStorage.setItem("vetos:transaction-draft:v1:u1:transaction:pos:pemindahan:terima:src1", JSON.stringify({ version: 1, savedAt: Date.now(), requestKey: "draf-2", fields: {},
    snapshot: { qty: { item: 3 }, requestKey: STALE_KEY } }));
  fixture.terima.mockResolvedValueOnce({ ...REJECT, message: REJECT.message.replace("Pemindahan", "Penerimaan") }).mockResolvedValueOnce(undefined);
  await render(<TerimaForm userId="u1" sourceTransferId="src1" rows={[{ item_id: "item", name: "Hematologi Hm5", code: "ALK-00205", unit: "PCS", sisa: 5 }]} />);
  const before = keyOf();
  expect(host.textContent).toContain("Draf dipulihkan");
  expect(before).not.toBe(STALE_KEY);
  await submit();
  expect(host.textContent).toContain("Penerimaan ini BELUM tersimpan");
  expect(keyOf()).not.toBe(before);
  await submit();
  expect(keysSent(fixture.terima)).toEqual([before, keyOf()]);
  const saved = JSON.parse(sessionStorage.getItem("vetos:transaction-draft:v1:u1:transaction:pos:pemindahan:terima:src1")!);
  expect(saved.snapshot).not.toHaveProperty("requestKey");
});
