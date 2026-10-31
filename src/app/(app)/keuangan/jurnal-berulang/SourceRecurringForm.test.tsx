// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("@/components/CorrectionTransactionForm", () => ({
  CorrectionTransactionForm: ({ children }: { children: (state: { ready: boolean; storageError: boolean }) => React.ReactNode }) => <form>{children({ ready: true, storageError: false })}</form>,
}));
vi.mock("@/app/(app)/keuangan/jurnal-berulang/actions", () => ({ startRecurringFromJournal: async () => undefined }));
import { SourceRecurringForm } from "./SourceRecurringForm";

const source = { entry_id: "f6000000-0000-4000-8000-000000000001", no_jurnal: "JU-FIKTIF-1", tanggal: "2025-12-15", branch_id: null,
  revision: 0, source: "manual", deskripsi: "Fixture description", version: "fiction-hash", lines: [
    { line_id: "line-1", account_id: "account-1", code: "6001", debit: 100, credit: 0 },
    { line_id: "line-2", account_id: "account-2", code: "311001", debit: 0, credit: 100 },
  ] };
let root: Root | null = null;

afterEach(() => { if (root) act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

it("requires a fresh source confirmation and a separate confirmation for a backdated first month", () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root?.render(<SourceRecurringForm userId="fiction-user" source={source} firstPeriod="2026-11" currentPeriod="2026-10" />));
  const form = host.querySelector("form");
  expect(form).not.toBeNull();
  const submit = () => form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  expect(submit()?.disabled).toBe(true);
  const name = form?.querySelector<HTMLInputElement>('input[name="name"]');
  act(() => { if (name) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Fixture schedule"); name.dispatchEvent(new Event("input", { bubbles: true })); } });
  const sourceConfirm = form?.querySelector<HTMLInputElement>('input[name="confirm_source"]');
  expect(sourceConfirm?.checked).toBe(false);
  expect(sourceConfirm?.hasAttribute("data-draft-ignore")).toBe(true);
  act(() => sourceConfirm?.click());
  expect(submit()?.disabled).toBe(false);

  const first = form?.querySelector<HTMLInputElement>('input[name="first_period"]');
  act(() => { if (first) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(first, "2026-09"); first.dispatchEvent(new Event("input", { bubbles: true })); } });
  const backdate = form?.querySelector<HTMLInputElement>('input[name="confirm_backdated"]');
  expect(backdate?.checked).toBe(false);
  expect(backdate?.hasAttribute("data-draft-ignore")).toBe(true);
  expect(submit()?.disabled).toBe(true);
  act(() => backdate?.click());
  expect(submit()?.disabled).toBe(false);
});
