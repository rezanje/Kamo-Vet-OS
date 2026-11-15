// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/penjualan/[id]/actions", () => ({ batalkanPenerimaan: vi.fn(async () => {}), terimaPembayaranUlang: vi.fn(async () => {}), batalkanPencairan: vi.fn(async () => {}) }));
import { OnlineDisbursementCancelForm, SaleReceiptCancelForm, SaleReceiveAgainForm } from "@/app/(app)/penjualan/[id]/SaleReceiptForms";
import type { BatasTanggal } from "@/lib/tanggal-efektif-petshop";

let root: Root; let host: HTMLDivElement;
const saleId = "11111111-1111-1111-1111-111111111111";
const OWNER: BatasTanggal = { min: "2026-11-05", max: "2026-11-12", closedUntil: null, effectiveMin: "2026-11-05", canBackdate: true };
const field = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`);
const setDate = async (value: string) => act(async () => {
  const input = field("tanggal")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
});
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("tanpa batas tanggal (bentuk lama): tidak ada kolom tanggal", async () => {
  await act(async () => root.render(<SaleReceiptCancelForm userId="u" saleId={saleId} revision={1} total={1000} shiftClosed={false} />));
  expect(field("tanggal")).toBeNull();
});
it("Owner: kolom tanggal bawaan hari ini dalam kontrol tertutup 'Ubah tanggal pembukuan (opsional)' + satu catatan", async () => {
  await act(async () => root.render(<SaleReceiptCancelForm userId="u" saleId={saleId} revision={1} total={1000} shiftClosed={false} batasTanggal={OWNER} />));
  const d = field("tanggal")!;
  expect([d.type, d.min, d.max, d.value]).toEqual(["date", "2026-11-05", "2026-11-12", "2026-11-12"]);
  const box = host.querySelector<HTMLDetailsElement>('[data-testid="tanggal-efektif"]')!;
  expect(box.tagName).toBe("DETAILS"); expect(box.open).toBe(false);
  expect(box.querySelector("summary")!.textContent).toBe("Ubah tanggal pembukuan (opsional)");
  expect(box.textContent).toContain("Dicatat di tanggal ini; uang fisik tetap hari ini.");
  expect(host.textContent).not.toMatch(/mundur|Accurate|efektif/i);
});
it("memilih tanggal lain tidak menambah teks; catatan tetap satu kalimat", async () => {
  await act(async () => root.render(<SaleReceiptCancelForm userId="u" saleId={saleId} revision={1} total={1000} shiftClosed={false} batasTanggal={OWNER} />));
  await setDate("2026-11-10");
  expect(field("tanggal")!.value).toBe("2026-11-10");
  expect(host.querySelectorAll('[data-testid="tanggal-efektif"] p')).toHaveLength(1);
  expect(host.querySelector('[data-testid="tanggal-efektif"] p')!.textContent).toBe("Dicatat di tanggal ini; uang fisik tetap hari ini.");
  await setDate("2026-11-12");
  expect(field("tanggal")!.value).toBe("2026-11-12");
});
it("peran tanpa hak: tidak ada kolom dan tidak ada kata tentang tanggal sama sekali (server memakai hari ini)", async () => {
  await act(async () => root.render(<SaleReceiptCancelForm userId="u" saleId={saleId} revision={1} total={1000} shiftClosed={false} batasTanggal={{ ...OWNER, canBackdate: false }} />));
  expect(field("tanggal")).toBeNull();
  expect(host.querySelector('[data-testid="tanggal-efektif"]')).toBeNull();
  expect(host.textContent).not.toMatch(/tanggal|mundur|Owner|Akses Grup/i);
  const alasanTeks = host.textContent;
  await act(async () => root.render(<SaleReceiveAgainForm userId="u" saleId={saleId} revision={1} total={1000} previous={[]} batasTanggal={{ ...OWNER, canBackdate: false }} />));
  expect(host.textContent).not.toMatch(/tanggal|mundur|Owner|Akses Grup/i); expect(alasanTeks).toContain("Batalkan penerimaan");
});
it("periode tertutup: rentang mulai sesudah batas tutup (penolakan database tetap menjelaskan Tutup Buku)", async () => {
  await act(async () => root.render(<SaleReceiptCancelForm userId="u" saleId={saleId} revision={1} total={1000} shiftClosed={false} batasTanggal={{ ...OWNER, closedUntil: "2026-11-07", effectiveMin: "2026-11-08" }} />));
  expect(field("tanggal")!.min).toBe("2026-11-08");
});
it("periode tertutup sampai hari ini: kolom tetap valid (min tidak melewati max)", async () => {
  await act(async () => root.render(<SaleReceiptCancelForm userId="u" saleId={saleId} revision={1} total={1000} shiftClosed={false} batasTanggal={{ ...OWNER, closedUntil: "2026-11-12", effectiveMin: "2026-11-13" }} />));
  const d = field("tanggal")!;
  expect([d.min, d.max]).toEqual(["2026-11-12", "2026-11-12"]);
});
it("Terima pembayaran: alasan mengubah tanggal wajib muncul hanya bila tanggal sebelum hari ini", async () => {
  await act(async () => root.render(<SaleReceiveAgainForm userId="u" saleId={saleId} revision={1} total={1000} previous={[{ method: "Tunai", amount: 1000 }]} batasTanggal={OWNER} />));
  expect(field("alasan")).toBeNull();
  await setDate("2026-11-09");
  expect(field("alasan")!.required).toBe(true);
  await setDate("2026-11-12");
  expect(field("alasan")).toBeNull();
});
it("Batalkan pencairan: kolom tanggal ada di kontrol tertutup; alasan wajib bila tanggal diubah", async () => {
  await act(async () => root.render(<OnlineDisbursementCancelForm userId="u" saleId={saleId} revision={1} batasTanggal={OWNER} />));
  expect(field("tanggal")).not.toBeNull();
  await setDate("2026-11-08");
  expect(field("alasan")!.required).toBe(true);
});
