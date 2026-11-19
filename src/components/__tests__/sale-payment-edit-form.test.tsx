// @vitest-environment jsdom
// Ubah pembayaran satu langkah (permintaan Anisa, 19 Nov 2026).
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ edit: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/penjualan/[id]/actions", () => ({ batalkanPenerimaan: vi.fn(), terimaPembayaranUlang: vi.fn(), batalkanPencairan: vi.fn(), ubahPembayaran: fixture.edit }));
import { SalePaymentEditForm } from "@/app/(app)/penjualan/[id]/SaleReceiptForms";

let root: Root; let host: HTMLDivElement;
const saleId = "11111111-1111-1111-1111-111111111111";
const field = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`);
const button = () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const type = async (name: string, value: string) => act(async () => { const input = field(name)!; input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); });
const batas = { min: "2026-11-16", max: "2026-11-19", closedUntil: null, effectiveMin: "2026-11-16", canBackdate: true };
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("terisi pembayaran sekarang + tanggal bayar tercatat; simpan baru aktif setelah ada perubahan yang seimbang", async () => {
  await act(async () => root.render(<SalePaymentEditForm userId="owner" saleId={saleId} revision={2} total={100000}
    current={[{ method: "Tunai", amount: 100000 }]} tanggalBayar="2026-11-16" batasTanggal={batas} />));
  expect(host.textContent).toContain("Ubah pembayaran");
  expect(field("amount_Tunai")!.value).toBe("100000");
  expect(field("tanggal")!.value).toBe("2026-11-16");
  expect(field("tanggal")!.min).toBe("2026-11-16");
  expect(field("alasan")!.required).toBe(true);
  expect(button().disabled).toBe(true);
  expect(host.textContent).toContain("Belum ada yang diubah");
  await type("amount_Tunai", "40000");
  expect(button().disabled).toBe(true);
  expect(host.textContent).toContain("harus sama dengan total struk");
  await type("amount_Transfer", "60000");
  expect(button().disabled).toBe(false);
});
it("ganti tanggal saja juga dihitung perubahan", async () => {
  await act(async () => root.render(<SalePaymentEditForm userId="owner" saleId={saleId} revision={2} total={100000}
    current={[{ method: "Tunai", amount: 100000 }]} tanggalBayar="2026-11-16" batasTanggal={batas} />));
  await act(async () => { const input = field("tanggal")!; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(input, "2026-11-18"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(button().disabled).toBe(false);
});
it("tanpa izin tanggal mundur: kolom tanggal tidak tampil (server memakai hari ini)", async () => {
  await act(async () => root.render(<SalePaymentEditForm userId="finance" saleId={saleId} revision={0} total={50000}
    current={[{ method: "Tunai", amount: 50000 }]} tanggalBayar="2026-11-16" batasTanggal={{ ...batas, canBackdate: false }} />));
  expect(field("tanggal")).toBeNull();
  await type("amount_Tunai", "");
  await type("amount_QRIS", "50000");
  expect(button().disabled).toBe(false);
});
