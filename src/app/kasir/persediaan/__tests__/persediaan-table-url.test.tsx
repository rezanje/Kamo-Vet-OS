// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
import { PersediaanTable, type PersRow } from "../PersediaanTable";

const row = (i: number, status: string): PersRow => ({ id: `r${i}`, no: `PB-${i}`, createdAt: "2026-11-10T03:00:00Z", dari: "Toko", tujuan: i % 2 ? "Gudang A" : "Gudang B", itemCount: 2, status, dibuatOleh: "Kasir" });
const rows = [row(1, "Dikirim"), row(2, "Selesai"), row(3, "Dikirim"), ...Array.from({ length: 12 }, (_, i) => row(10 + i, "Disetujui"))];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, "", "/kasir/persediaan?tab=permintaan");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const ubah = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
};

it("filter diisi dari alamat: status, pencarian dan halaman", async () => {
  window.history.replaceState(null, "", "/kasir/persediaan?tab=permintaan&status=Dikirim&cari=gudang%20a");
  await act(async () => root.render(<PersediaanTable rows={rows} tab="permintaan" awal={{ status: "Dikirim", cari: "gudang a" }} />));
  expect(container.querySelector("select")!.value).toBe("Dikirim");
  expect((container.querySelector('input[placeholder^="Cari"]') as HTMLInputElement).value).toBe("gudang a");
  expect(container.querySelectorAll("tbody tr")).toHaveLength(2); // r1, r3 (Gudang A, Dikirim)
});

it("halaman dari alamat dipakai (halaman 2 dari 15 baris, 8 per halaman)", async () => {
  await act(async () => root.render(<PersediaanTable rows={rows} tab="permintaan" awal={{ hal: "2" }} />));
  expect(container.querySelectorAll("tbody tr")).toHaveLength(7);
});

it("mengubah filter ikut menulis alamat (tab dipertahankan) tanpa memuat ulang", async () => {
  await act(async () => root.render(<PersediaanTable rows={rows} tab="permintaan" />));
  await ubah(container.querySelector("select")!, "Selesai");
  expect(window.location.search).toBe("?tab=permintaan&status=Selesai");
  await ubah(container.querySelector('input[placeholder^="Cari"]') as HTMLInputElement, "PB-2");
  expect(window.location.search).toBe("?tab=permintaan&status=Selesai&cari=PB-2");
  await ubah(container.querySelector("select")!, "");
  await ubah(container.querySelector('input[placeholder^="Cari"]') as HTMLInputElement, "");
  expect(window.location.search).toBe("?tab=permintaan");
});

it("tanpa filter alamat tidak diubah saat dibuka", async () => {
  const sebelum = window.location.href;
  await act(async () => root.render(<PersediaanTable rows={rows} tab="permintaan" />));
  expect(window.location.href).toBe(sebelum);
});
