// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/kas-bank/transfer/actions", () => ({ pulihkanTransfer: vi.fn() }));
import { TransferRecovery } from "@/app/(app)/kas-bank/transfer/TransferRecovery";
import { pulihkanTransfer } from "@/app/(app)/kas-bank/transfer/actions";
it("recovers an old revision after the source row disappears without reposting", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear();
  const scope = "bank-transfer-edit-f7100000-0000-4000-8000-000000000001-0";
  sessionStorage.setItem(`vetos:correction-key:v1:owner:${scope}`, "committed-key");
  sessionStorage.setItem(`vetos:correction-key:v1:another:${scope}`, "other-key");
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<TransferRecovery userId="owner"/>));
    expect(host.querySelectorAll("form")).toHaveLength(1);
    expect(host.querySelector<HTMLInputElement>('input[name="draft_key"]')?.value).toBe("committed-key");
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(pulihkanTransfer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pulihkanTransfer).mock.calls[0][0].get("draft_scope")).toBe(scope);
    expect(sessionStorage.getItem(`vetos:correction-key:v1:owner:${scope}`)).toBe("committed-key");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
