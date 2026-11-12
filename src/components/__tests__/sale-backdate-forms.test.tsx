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
it("Owner: kolom tanggal bawaan hari ini dengan rentang tanggal struk .. hari ini; tidak ada peringatan mundur", async () => {
  await act(async () => root.render(<SaleReceiptCancelForm userId="u" saleId={saleId} revision={1} total={1000} shiftClosed={false} batasTanggal={OWNER} />));
  const d = field("tanggal")!;
  expect([d.type, d.min, d.max, d.value]).toEqual(["date", "2026-11-05", "2026-11-12", "2026-11-12"]);
  expect(host.querySelector('[data-testid="tanggal-efektif-mundur"]')).toBeNull();
  expect(host.textContent).toContain("05/11/2026 sampai 12/11/2026");
});
it("memilih tanggal sebelum hari ini menampilkan akibatnya (omzet struk tidak berubah, laci tetap shift sekarang)", async () => {
  await act(async () => root.render(<SaleReceiptCancelForm userId="u" saleId={saleId} revision={1} total={1000} shiftClosed={false} batasTanggal={OWNER} />));
  await setDate("2026-11-10");
  const note = host.querySelector('[data-testid="tanggal-efektif-mundur"]')!;
  expect(note.textContent).toContain("10/11/2026");
  expect(note.textContent).toContain("bukan hari ini");
  expect(note.textContent).toContain("shift Anda");
  await setDate("2026-11-12");
  expect(host.querySelector('[data-testid="tanggal-efektif-mundur"]')).toBeNull();
});
it("peran yang tak boleh mundur: tidak ada kolom (server memakai hari ini) dan alasannya dijelaskan", async () => {
  await act(async () => root.render(<SaleReceiptCancelForm userId="u" saleId={saleId} revision={1} total={1000} shiftClosed={false} batasTanggal={{ ...OWNER, canBackdate: false }} />));
  expect(field("tanggal")).toBeNull();
  expect(host.querySelector('[data-testid="tanggal-efektif-hanya-hari-ini"]')!.textContent).toContain("Tanggal mundur");
});
it("periode tertutup: rentang mulai sesudah batas tutup dan petunjuk Tutup Buku tampil", async () => {
  await act(async () => root.render(<SaleReceiptCancelForm userId="u" saleId={saleId} revision={1} total={1000} shiftClosed={false} batasTanggal={{ ...OWNER, closedUntil: "2026-11-07", effectiveMin: "2026-11-08" }} />));
  expect(field("tanggal")!.min).toBe("2026-11-08");
  expect(host.textContent).toContain("ditutup sampai 07/11/2026");
  expect(host.textContent).toContain("Tutup Buku");
});
it("periode tertutup sampai hari ini: kolom tetap valid (min tidak melewati max)", async () => {
  await act(async () => root.render(<SaleReceiptCancelForm userId="u" saleId={saleId} revision={1} total={1000} shiftClosed={false} batasTanggal={{ ...OWNER, closedUntil: "2026-11-12", effectiveMin: "2026-11-13" }} />));
  const d = field("tanggal")!;
  expect([d.min, d.max]).toEqual(["2026-11-12", "2026-11-12"]);
});
it("Terima pembayaran: alasan tanggal mundur wajib muncul hanya bila tanggal sebelum hari ini", async () => {
  await act(async () => root.render(<SaleReceiveAgainForm userId="u" saleId={saleId} revision={1} total={1000} previous={[{ method: "Tunai", amount: 1000 }]} batasTanggal={OWNER} />));
  expect(field("alasan")).toBeNull();
  await setDate("2026-11-09");
  expect(field("alasan")!.required).toBe(true);
  await setDate("2026-11-12");
  expect(field("alasan")).toBeNull();
});
it("Batalkan pencairan: kolom tanggal ada dan memakai kata pembalikan pencairan", async () => {
  await act(async () => root.render(<OnlineDisbursementCancelForm userId="u" saleId={saleId} revision={1} batasTanggal={OWNER} />));
  expect(field("tanggal")).not.toBeNull();
  await setDate("2026-11-08");
  expect(host.textContent).toContain("Pembalikan dibukukan di tanggal 08/11/2026");
  expect(field("alasan")!.required).toBe(true);
});
