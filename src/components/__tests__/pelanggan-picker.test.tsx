// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PelangganPicker } from "@/components/PelangganPicker";
import { pasangApiPelangganPalsu } from "./pelanggan-fake-api";

const rows = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Yayan", phone: "089685270100" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Bu Yayang", phone: "0812-1627-1662" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Andi", phone: "081311112222" },
];
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const settle = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  await act(async () => { await Promise.resolve(); });
};
const input = () => host.querySelector<HTMLInputElement>("[role=combobox]")!;
const hidden = () => host.querySelector<HTMLInputElement>('input[type=hidden][name="customer_id"]')!;
const options = () => [...host.querySelectorAll<HTMLElement>("[role=option]")];
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

it("mencari di server lalu mengisi customer_id yang dikirim form", async () => {
  const api = pasangApiPelangganPalsu(rows);
  await act(async () => root.render(<form><PelangganPicker required /></form>));
  expect(input().validity.valid).toBe(false); // wajib pilih dari daftar
  await type("yay");
  expect(api).toHaveBeenCalledTimes(1);
  expect(options().map((o) => o.textContent)).toEqual(["Bu Yayang · 0812-1627-1662", "Yayan · 089685270100"]);
  await act(async () => { options()[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  expect(hidden().value).toBe(rows[0].id);
  expect(input().value).toBe("Yayan · 089685270100");
  expect(input().validity.valid).toBe(true);
  expect(new FormData(host.querySelector("form")!).get("customer_id")).toBe(rows[0].id);
  // Mengetik lagi melepas pilihan supaya id lama tidak ikut terkirim diam-diam.
  await type("and");
  expect(hidden().value).toBe("");
  expect(options().map((o) => o.textContent)).toEqual(["Andi · 081311112222"]);
});

it("menemukan nomor HP yang tersimpan dengan tanda hubung dan memberi tahu bila tidak ada", async () => {
  pasangApiPelangganPalsu(rows);
  await act(async () => root.render(<PelangganPicker />));
  await type("081216271662");
  expect(options().map((o) => o.textContent?.split(" ·")[0])).toEqual(["Bu Yayang"]);
  await type("tidak-ada-orangnya");
  expect(host.querySelector("[role=status]")?.textContent).toContain("tidak ditemukan");
});

it("tidak menawarkan pelanggan yang dikecualikan (pemilik lama)", async () => {
  pasangApiPelangganPalsu(rows);
  await act(async () => root.render(<PelangganPicker kecuali={rows[0].id} />));
  await type("yay");
  expect(options().map((o) => o.textContent?.split(" ·")[0])).toEqual(["Bu Yayang"]);
});

it("memulihkan pelanggan dari draf transaksi dengan memuat namanya dari server", async () => {
  const api = pasangApiPelangganPalsu(rows);
  await act(async () => root.render(<form><PelangganPicker /></form>));
  await act(async () => {
    hidden().value = rows[2].id;
    hidden().dispatchEvent(new CustomEvent("vetos:draft-restore", { detail: rows[2].id }));
  });
  await settle();
  expect(api).toHaveBeenCalledWith(expect.stringContaining(`id=${rows[2].id}`), expect.anything());
  expect(input().value).toBe("Andi · 081311112222");
  expect(hidden().value).toBe(rows[2].id);
});

it("menampilkan pelanggan awal saat mengedit", async () => {
  pasangApiPelangganPalsu(rows);
  await act(async () => root.render(<PelangganPicker initial={rows[1]} />));
  expect(hidden().value).toBe(rows[1].id);
  expect(input().value).toBe("Bu Yayang · 0812-1627-1662");
});
