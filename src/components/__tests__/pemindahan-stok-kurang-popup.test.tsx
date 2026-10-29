// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const aksi = vi.hoisted(() => ({ buatKirim: vi.fn() }));
vi.mock("@/app/(app)/pos/pemindahan/actions", () => aksi);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { PemindahanForm } from "@/app/(app)/pos/pemindahan/baru/PemindahanForm";

const warehouses = [{ id: "wh-1", name: "Gudang Pusat" }, { id: "wh-2", name: "Gudang Cabang" }];
const items = [{ id: "itm-a", code: "OBT-A", name: "Obat A", unit: "pcs", units: [{ unit: "pcs", factor: 1, sell_price: 0, buy_price: 0 }] }];
const stock = [{ id: "stk-1", warehouse_id: "wh-1", item_id: "itm-a", qty: 250 }];

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const qtyInput = () => host.querySelector<HTMLInputElement>('input[title="Kuantitas"]')!;
const isi = (el: HTMLInputElement | HTMLSelectElement, value: string) => act(async () => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
});

/** Gudang asal + satu baris Obat A sebanyak `qty`. */
async function siapkan(qty: string) {
  await act(async () => root.render(<PemindahanForm warehouses={warehouses} items={items} userId="user" stock={stock} />));
  await isi(host.querySelector<HTMLSelectElement>('select[name="from_warehouse_id"]')!, "wh-1");
  await isi(host.querySelector<HTMLSelectElement>('select[name="to_warehouse_id"]')!, "wh-2");
  const cari = host.querySelector<HTMLInputElement>('input[aria-label="Barang pemindahan 1"]')!;
  await act(async () => cari.focus());
  await act(async () => document.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  await isi(qtyInput(), qty);
}

it("jumlah di atas stok: kolom merah di baris, tombol kirim TIDAK lagi dimatikan diam-diam", async () => {
  await siapkan("500");
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("Kurang 250 pcs");
  const kirim = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Kirim barang"))!;
  expect(kirim.hasAttribute("disabled")).toBe(false);
});

it("menekan Kirim memunculkan popup berisi barang, gudang asal, dan angka kurangnya", async () => {
  await siapkan("500");
  await act(async () => host.querySelector("form")!.requestSubmit());

  const dialog = host.querySelector("dialog")!;
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(host.querySelector("#stok-kurang-judul")!.textContent).toContain("Stok tidak cukup");
  expect(Array.from(host.querySelectorAll("tbody tr td")).map((td) => td.textContent))
    .toEqual(["Obat A", "Gudang Pusat", "500 pcs", "250 pcs", "250 pcs"]);
  // Pemindahannya tidak dikirim ke server.
  expect(aksi.buatKirim).not.toHaveBeenCalled();

  await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Ubah jumlah"))!.click());
  expect(host.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(qtyInput());
});

it("jumlah dalam batas stok lolos tanpa popup dan diteruskan ke server", async () => {
  await siapkan("250");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => host.querySelector("form")!.requestSubmit());
  expect(host.querySelector("dialog")).toBeNull();
  expect(aksi.buatKirim).toHaveBeenCalled();
});
