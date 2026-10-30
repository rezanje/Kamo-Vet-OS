// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const navigate = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigate }));
const save = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/klinik/rawat-inap/[id]/tagihan/actions", () => ({ simpanBayar: save }));
import { SimpanBayarForm } from "@/app/(app)/klinik/rawat-inap/[id]/tagihan/SimpanBayarForm";
let host: HTMLDivElement, root: Root;
const accounts = ["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"].map(method => ({ method, code: method === "Tunai" ? "1101" : "1102", name: "Rekening Fiktif", bank: "Bank Fiktif", number: "123456" }));
const quote = { token: "current-quote", remaining: 100000, amount: 150000, excess: 50000, credit: 0, pending: 100000, debt: 0, subtotal: 100000, tax: 0, accounts };
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); save.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (remaining = 100000) => act(async () => root.render(<SimpanBayarForm recordId="r" visitId="v" requestKey="k" remaining={remaining} pendingCount={1} accounts={accounts} dpOpsional={50000} />));
const button = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent === label)!;
const click = async (b: HTMLElement) => act(async () => b.click());
const amount = (index = 1) => host.querySelector<HTMLInputElement>(`[aria-label="Nominal pembayaran ${index}"]`)!;
async function type(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function submit() { await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
it("has six colored methods and actual mapped bank; choosing noncash fills only empty draft", async () => {
  await render();
  expect(host.querySelectorAll('[aria-pressed]')).toHaveLength(6);
  await click(button("Transfer")); expect(amount().value).toBe("100000");
  expect(host.textContent).toContain("Bank Fiktif"); expect(host.textContent).toContain("123456");
  await type(amount(), "30000"); await click(button("Debit")); expect(amount().value).toBe("30000");
  expect(save).not.toHaveBeenCalled();
});
it("split parts stay intact and optional DP cannot clobber typed money", async () => {
  await render(); await type(amount(), "30000"); await click(button("Tambah metode")); await type(amount(2), "20000");
  expect(button("Isi DP 50% sisa total").disabled).toBe(true);
  expect(JSON.parse(host.querySelector<HTMLInputElement>('[name="parts"]')!.value)).toEqual([{ method: "Tunai", amount: 30000 }, { method: "Transfer", amount: 20000 }]);
});
it("prominent excess warning before submit; cancel ack does not submit money", async () => {
  await render(); await type(amount(), "150000");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Lebih Rp 50.000 disimpan sebagai saldo pemilik");
  save.mockResolvedValue({ status: "OVERPAYMENT_CONFIRM_REQUIRED", quote });
  await submit(); expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(save.mock.calls[0][0].get("overpayment_ack")).toBeNull();
  await click(button("Batal")); expect(save).toHaveBeenCalledTimes(1); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(amount().value).toBe("150000");
});
it("explicit confirmation sends exact current token and original typed parts", async () => {
  await render(); await type(amount(), "150000"); save.mockResolvedValueOnce({ status: "OVERPAYMENT_CONFIRM_REQUIRED", quote }).mockResolvedValueOnce({ status: "ERROR", error: "Fixture stopped before redirect" });
  await submit(); await click(button("Setuju, simpan saldo pemilik"));
  expect(save).toHaveBeenCalledTimes(2); expect(save.mock.calls[1][0].get("overpayment_ack")).toBe("current-quote");
  expect(JSON.parse(save.mock.calls[1][0].get("parts"))).toEqual([{ method: "Tunai", amount: 150000 }]);
});
it("changed quote with no excess still requires reviewing current balance, not false credit", async () => {
  await render(); await type(amount(), "150000");
  save.mockResolvedValue({ status: "OVERPAYMENT_CONFIRM_REQUIRED", quote: { ...quote, remaining: 200000, excess: 0 } });
  await submit(); const dialog = host.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Tagihan berubah"); expect(dialog.textContent).toContain("Tidak ada kelebihan bayar");
  expect(button("Setuju, lanjutkan pembayaran")).toBeDefined();
});
it("saved real-document URL navigates without swallowing a Next redirect in local catch", async () => {
  await render(); await type(amount(), "100000");
  const href = "/klinik/rawat-inap/r/tagihan?success=transaksi&receipt=receipt";
  save.mockResolvedValue({ status: "SAVED", href });
  await submit(); expect(navigate.push).toHaveBeenCalledWith(href); expect(navigate.refresh).toHaveBeenCalledTimes(1);
});
it("zero new money has explicit save later path; settled primary is disabled", async () => {
  await render(); expect(button("Simpan transaksi · Bayar nanti").disabled).toBe(false);
  await act(async () => root.render(<SimpanBayarForm recordId="r" visitId="v" requestKey="k" remaining={0} pendingCount={0} accounts={accounts} />));
  expect(button("Simpan transaksi · Bayar nanti").disabled).toBe(true);
});
