// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ cancel: vi.fn(async () => {}), receive: vi.fn(async () => {}), disb: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/penjualan/[id]/actions", () => ({ batalkanPenerimaan: fixture.cancel, terimaPembayaranUlang: fixture.receive, batalkanPencairan: fixture.disb }));
import { OnlineDisbursementCancelForm, SaleReceiptCancelForm, SaleReceiveAgainForm } from "@/app/(app)/penjualan/[id]/SaleReceiptForms";

let root: Root; let host: HTMLDivElement;
const saleId = "11111111-1111-1111-1111-111111111111";
const field = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const button = () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const type = async (name: string, value: string) => act(async () => { const input = field(name); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); });
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("Batalkan penerimaan: menjelaskan akibatnya, alasan dan konfirmasi wajib, peringatan shift tertutup", async () => {
  await act(async () => root.render(<SaleReceiptCancelForm userId="owner" saleId={saleId} revision={3} total={150000} shiftClosed />));
  const text = host.textContent ?? "";
  expect(text).toContain("Batalkan penerimaan");
  expect(text).toContain("Rp 150.000");
  expect(text).toContain("belum dibayar");
  expect(text).toContain("Shift struk ini sudah ditutup");
  expect(field("alasan").required).toBe(true);
  expect(field("konfirmasi").required).toBe(true);
  expect(field("revision").value).toBe("3");
});
it("tanpa shift tertutup tidak menampilkan peringatan shift", async () => {
  await act(async () => root.render(<SaleReceiptCancelForm userId="owner" saleId={saleId} revision={0} total={1000} shiftClosed={false} />));
  expect(host.textContent).not.toContain("Shift struk ini sudah ditutup");
});
it("Terima pembayaran: kolom terisi dari penerimaan lama, tombol aktif hanya bila jumlah sama dengan total", async () => {
  await act(async () => root.render(<SaleReceiveAgainForm userId="owner" saleId={saleId} revision={1} total={100000} previous={[{ method: "Tunai", amount: 40000 }, { method: "QRIS", amount: 60000 }]} />));
  expect(field("amount_Tunai").value).toBe("40000");
  expect(field("amount_QRIS").value).toBe("60000");
  expect(field("amount_Transfer").value).toBe("");
  expect(button().disabled).toBe(false);
  await type("amount_QRIS", "50000");
  expect(button().disabled).toBe(true);
  expect(host.textContent).toContain("harus sama dengan total struk Rp 100.000");
  await type("amount_Transfer", "10000");
  expect(button().disabled).toBe(false);
  await type("amount_Tunai", "40000.555");
  expect(button().disabled).toBe(true);
  expect(host.textContent).toContain("maksimal dua desimal");
});
it("Terima pembayaran: semua kolom kosong tidak bisa dikirim; enam metode tersedia", async () => {
  await act(async () => root.render(<SaleReceiveAgainForm userId="owner" saleId={saleId} revision={1} total={100000} previous={[]} />));
  for (const m of ["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"]) expect(field(`amount_${m}`)).toBeTruthy();
  expect(button().disabled).toBe(true);
});
it("Batalkan pencairan: alasan dan konfirmasi wajib", async () => {
  await act(async () => root.render(<OnlineDisbursementCancelForm userId="owner" saleId={saleId} revision={1} />));
  expect(host.textContent).toContain("piutang marketplace");
  expect(field("alasan").required && field("konfirmasi").required).toBe(true);
});
