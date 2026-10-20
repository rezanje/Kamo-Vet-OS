// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";

let root: Root; let host: HTMLDivElement;
const action = vi.fn(async () => {});
const scope = "journal-edit-entry-revision";
const render = async () => act(async () => root.render(<CorrectionTransactionForm userId="user-a" scope={scope} action={action}>
  {({ ready }) => <button type="submit" disabled={!ready}>Simpan</button>}
</CorrectionTransactionForm>));
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); action.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("keeps the correction key after an expired twelve-hour draft", async () => {
  await render();
  const key = host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value;
  const draftName = "vetos:transaction-draft:v1:user-a:transaction:" + scope;
  sessionStorage.setItem(draftName, JSON.stringify({ version: 1, savedAt: 1, requestKey: key, fields: {}, snapshot: {} }));
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value).toBe(key);
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
});

it("fails closed when session storage cannot persist the posting key", async () => {
  const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  try { await render(); expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true); expect(host.textContent).toContain("Penyimpanan browser tidak tersedia"); }
  finally { blocked.mockRestore(); }
});
