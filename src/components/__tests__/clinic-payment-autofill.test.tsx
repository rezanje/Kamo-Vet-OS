// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Andri 29 Okt: di kasir petshop, metode selain Tunai langsung terisi sejumlah tagihan.
// Pembayaran klinik disamakan; kasir tetap boleh mengubah jumlah (DP sebagian).
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
import { PembayaranForm } from "@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";

const service = { deskripsi: "Jasa fiktif", qty: 1, harga: 100000, jenis: "jasa", item_id: "service" };
const props = {
  visitId: "visit", requestKey: "request", draftUserId: "cashier",
  patient: { photo: null, name: "Pasien fiktif", species: "Kucing", owner: "Pemilik", phone: "", address: "",
    dokter: "Dokter", jenisLayanan: "Klinik", noInvoice: "(baru)", tanggal: "2026-10-28" },
  initialObat: [], initialJasa: [service], catatanResep: null,
  bekal: { promos: [], aturanDiskon: [], golonganPersen: 0, infoBarang: {}, vouchers: [], hariIni: "2026-10-28",
    customerId: null, categoryId: null, poinSaldo: 0, rupiahPerPoin: 1 },
};
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  try { sessionStorage.clear(); } catch { /* jsdom lokal */ }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const jumlah = () => host.querySelector<HTMLInputElement>('input[aria-label="Jumlah Bayar"]')!;
const hidden = (name: string) => host.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)!.value;
const pilih = async (m: string) => {
  const b = [...host.querySelectorAll<HTMLButtonElement>("button")].find(x => x.textContent?.trim().startsWith(m))!;
  await act(async () => b.click());
};
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

it("Tunai: jumlah bayar tetap kosong sampai kasir mengetik uang diterima", async () => {
  await act(async () => root.render(React.createElement(PembayaranForm, props)));
  expect(jumlah().value).toBe("");
  expect(hidden("paid_status")).toBe("Belum Lunas");
});

it("metode selain Tunai: jumlah bayar otomatis = sisa tagihan (Lunas)", async () => {
  await act(async () => root.render(React.createElement(PembayaranForm, props)));
  await pilih("Transfer");
  expect(Number(jumlah().value)).toBe(100000);
  expect(hidden("paid_status")).toBe("Lunas");
});

it("kasir boleh mengubah jumlah non-Tunai jadi DP sebagian", async () => {
  await act(async () => root.render(React.createElement(PembayaranForm, props)));
  await pilih("Transfer");
  await act(async () => { setter.call(jumlah(), "40000"); jumlah().dispatchEvent(new Event("input", { bubbles: true })); });
  expect(hidden("paid_status")).toBe("DP");
  expect(hidden("dp_amount")).toBe("40000");
});
