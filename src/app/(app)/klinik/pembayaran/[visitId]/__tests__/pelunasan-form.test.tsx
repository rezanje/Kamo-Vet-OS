// @vitest-environment jsdom
// Form pelunasan kasir: bayar campuran Tunai/Transfer, tidak bisa melebihi sisa,
// dan yang dikirim ke aksi adalah invoice + sisa yang dilihat kasir.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ forms: [] as FormData[] }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/pelunasan-actions", () => ({
  lunasiTagihanKlinik: async (data: FormData) => { sent.forms.push(data); },
}));
import { PelunasanTagihanForm } from "@/app/(app)/klinik/pembayaran/[visitId]/PelunasanTagihanForm";

let root: Root, host: HTMLDivElement;
const button = (name: string) => [...host.querySelectorAll("button")].find(node => node.textContent?.trim().includes(name));
const hidden = (name: string) => host.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)!.value;
async function setValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
const amount = (i: number) => host.querySelector<HTMLInputElement>(`input[aria-label="Nominal pembayaran ${i}"]`)!;
const method = (i: number) => host.querySelector<HTMLSelectElement>(`select[aria-label="Metode pembayaran ${i}"]`)!;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sent.forms = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<PelunasanTagihanForm visitId="visit-1" invoiceId="inv-1" invoiceNo="INV-PRODUK-1"
    total={50000} diterima={30000} sisa={20000} requestKey="kunci-1" />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("mengisi sisa penuh sebagai default dan mengirim invoice yang sama", async () => {
  expect(amount(1).value).toBe("20000");
  expect(hidden("invoice_id")).toBe("inv-1");
  expect(hidden("expected_remaining")).toBe("20000");
  expect(JSON.parse(hidden("parts"))).toEqual([{ method: "Tunai", amount: 20000 }]);
  expect(host.textContent).toContain("Sudah diterima (DP & pembayaran sebelumnya)Rp 30.000");
});

it("menyusun pembayaran campuran Tunai + Transfer", async () => {
  await setValue(amount(1), "5000");
  await act(async () => button("Tambah metode")!.click());
  expect(method(2).value).toBe("Transfer");
  expect(amount(2).value).toBe("15000");
  expect(JSON.parse(hidden("parts"))).toEqual([{ method: "Tunai", amount: 5000 }, { method: "Transfer", amount: 15000 }]);
  expect(button("Terima Pelunasan")!.disabled).toBe(false);
  await act(async () => { host.querySelector("form")!.requestSubmit(); });
  expect(sent.forms).toHaveLength(1);
  expect(sent.forms[0].get("request_key")).toBe("kunci-1");
  expect(JSON.parse(String(sent.forms[0].get("parts")))).toEqual([{ method: "Tunai", amount: 5000 }, { method: "Transfer", amount: 15000 }]);
});

it("mengunci tombol bila total melebihi sisa atau nominal kosong", async () => {
  await setValue(amount(1), "25000");
  expect(host.textContent).toContain("melebihi sisa");
  expect(button("Terima Pelunasan")!.disabled).toBe(true);
  await setValue(amount(1), "");
  expect(button("Terima Pelunasan")!.disabled).toBe(true);
});
