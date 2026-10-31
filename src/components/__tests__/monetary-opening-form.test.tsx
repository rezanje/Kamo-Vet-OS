// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { previewAction } = vi.hoisted(() => ({ previewAction: vi.fn() }));
vi.mock("@/app/(app)/kas-bank/rekening/[id]/saldo-awal/actions", () => ({ previewMonetaryOpening: previewAction, correctMonetaryOpening: vi.fn() }));
vi.mock("@/components/CorrectionTransactionForm", () => ({ CorrectionTransactionForm: ({ children }: { children: (status: { ready: boolean }) => React.ReactNode }) => <form>{children({ ready: true })}</form> }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: ({ children, disabled }: { children: React.ReactNode; disabled: boolean }) => <button type="submit" disabled={disabled}>{children}</button> }));
import { MonetaryOpeningForm } from "@/app/(app)/kas-bank/rekening/[id]/saldo-awal/MonetaryOpeningForm";
let host: HTMLDivElement; let root: Root;
beforeEach(async () => { vi.clearAllMocks(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); await act(async () => root.render(<MonetaryOpeningForm userId="owner" accountId="bank" />)); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function fill(name: string, value: string) {
  const input = host.querySelector(`[name="${name}"]`)!;
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
const save = () => [...host.querySelectorAll("button")].find(b => b.textContent === "Simpan koreksi saldo awal")!;
const preview = () => [...host.querySelectorAll("button")].find(b => b.textContent === "Preview dampak")!;
const evidence = { account_id: "bank", account_code: "120002", tanggal: "2026-10-01", old_amount: 50000000, new_amount: 5000000, delta: -45000000, balance_before: 49000000, balance_after: 4000000, reason: "Wrong amount", revision: 0, reversal: [{ code: "120002", debit: 0, credit: 50000000 }, { code: "410001", debit: 50000000, credit: 0 }], replacement: [{ code: "120002", debit: 5000000, credit: 0 }, { code: "410001", debit: 0, credit: 5000000 }] };
it("requires preview and invalidates it when the amount or reason changes", async () => {
  expect(save().disabled).toBe(true);
  await fill("amount", "5000000"); await fill("reason", "Wrong amount");
  previewAction.mockResolvedValue({ preview: evidence });
  await act(async () => preview().click());
  expect(save().disabled).toBe(false);
  expect(host.textContent).toContain("Saldo berjalan setelah koreksi");
  expect(host.textContent).toContain("4.000.000");
  expect(JSON.parse((host.querySelector('[name="preview"]') as HTMLInputElement).value)).toEqual(evidence);
  await fill("reason", "New reason");
  expect(save().disabled).toBe(true);
  expect((host.querySelector('[name="preview"]') as HTMLInputElement).value).toBe("");
});
it("ignores a preview response that arrives after the inputs changed", async () => {
  let resolve!: (value: unknown) => void;
  previewAction.mockReturnValue(new Promise(r => { resolve = r; }));
  await fill("amount", "5000000"); await fill("reason", "Wrong amount");
  await act(async () => preview().click());
  await fill("amount", "6000000");
  await act(async () => resolve({ preview: evidence }));
  expect(save().disabled).toBe(true);
  expect(host.textContent).not.toContain("Saldo berjalan setelah koreksi");
});
it("shows dependency failures and keeps the entered reason/amount", async () => {
  await fill("amount", "5000000"); await fill("reason", "Wrong amount");
  previewAction.mockResolvedValue({ error: "Rekonsiliasi harus dikoreksi dahulu" });
  await act(async () => preview().click());
  expect(host.textContent).toContain("Rekonsiliasi harus dikoreksi dahulu");
  expect((host.querySelector('[name="amount"]') as HTMLInputElement).value).toBe("5000000");
  expect(save().disabled).toBe(true);
});
