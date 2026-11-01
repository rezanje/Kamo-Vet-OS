// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ refresh: vi.fn(), createClient: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mock.createClient }));
import { ANTRIAN_REFRESH_MS, LiveRefresh } from "@/app/(app)/klinik/antrian/LiveRefresh";
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function render(branchId = "branch-a") { await act(async () => root.render(<LiveRefresh branchId={branchId} />)); }
async function tick(ms: number) { await act(async () => vi.advanceTimersByTime(ms)); }

it("tidak membuka langganan Realtime (beban database terbesar 1 Nov 2026)", async () => {
  await render();
  expect(mock.createClient).not.toHaveBeenCalled();
});
it("memperbarui antrian berkala selama layar terlihat", async () => {
  expect(ANTRIAN_REFRESH_MS).toBe(20_000);
  await render(); await tick(ANTRIAN_REFRESH_MS - 1); expect(mock.refresh).not.toHaveBeenCalled();
  await tick(251); expect(mock.refresh).toHaveBeenCalledOnce();
  await tick(ANTRIAN_REFRESH_MS); expect(mock.refresh).toHaveBeenCalledTimes(2);
});
it("resumes on focus, reconnect and visibility without refreshing a hidden or offline page", async () => {
  await render(); Object.defineProperty(document, "visibilityState", { value: "hidden" });
  await tick(ANTRIAN_REFRESH_MS * 2); expect(mock.refresh).not.toHaveBeenCalled();
  Object.defineProperty(document, "visibilityState", { value: "visible" });
  document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); await tick(250);
  expect(mock.refresh).toHaveBeenCalledOnce();
  Object.defineProperty(navigator, "onLine", { value: false }); await tick(ANTRIAN_REFRESH_MS * 2); expect(mock.refresh).toHaveBeenCalledOnce();
  Object.defineProperty(navigator, "onLine", { value: true }); window.dispatchEvent(new Event("online")); await tick(250);
  expect(mock.refresh).toHaveBeenCalledTimes(2);
});
it("cleans up timers and listeners when navigating or switching branch", async () => {
  await render(); await render("branch-b");
  await act(async () => root.render(null)); const calls = mock.refresh.mock.calls.length;
  window.dispatchEvent(new Event("focus")); await tick(ANTRIAN_REFRESH_MS * 2); expect(mock.refresh).toHaveBeenCalledTimes(calls);
});
