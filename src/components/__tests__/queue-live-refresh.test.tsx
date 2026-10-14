// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ refresh: vi.fn(), remove: vi.fn(), on: vi.fn(), subscribe: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  channel: () => ({ on: mock.on, subscribe: mock.subscribe }), removeChannel: mock.remove,
}) }));
import { LiveRefresh } from "@/app/(app)/klinik/antrian/LiveRefresh";
let root: Root;
let host: HTMLDivElement;
let change: () => void;
let status: (s: string) => void;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  mock.on.mockImplementation((_event, _filter, callback) => { change = callback; return { subscribe: mock.subscribe }; });
  mock.subscribe.mockImplementation(callback => { status = callback; return {}; });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function render(branchId = "branch-a") { await act(async () => root.render(<LiveRefresh branchId={branchId} />)); }
async function tick(ms: number) { await act(async () => vi.advanceTimersByTime(ms)); }
it("subscribes to the active branch and catches changes during subscription setup", async () => {
  await render(); expect(mock.on.mock.calls[0][1]).toMatchObject({ table: "visits", filter: "branch_id=eq.branch-a" });
  status("SUBSCRIBED"); await tick(250); expect(mock.refresh).toHaveBeenCalledOnce();
  change(); change(); await tick(250); expect(mock.refresh).toHaveBeenCalledTimes(2);
});
it("refreshes on a bounded interval even if realtime never connects", async () => {
  await render(); status("CHANNEL_ERROR"); await tick(15_250); expect(mock.refresh).toHaveBeenCalledOnce();
  await tick(15_000); expect(mock.refresh).toHaveBeenCalledTimes(2);
});
it("resumes on focus, reconnect and visibility without refreshing a hidden or offline page", async () => {
  await render(); Object.defineProperty(document, "visibilityState", { value: "hidden" });
  await tick(30_000); change(); await tick(250); expect(mock.refresh).not.toHaveBeenCalled();
  Object.defineProperty(document, "visibilityState", { value: "visible" });
  document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); await tick(250);
  expect(mock.refresh).toHaveBeenCalledOnce();
  Object.defineProperty(navigator, "onLine", { value: false }); await tick(30_000); expect(mock.refresh).toHaveBeenCalledOnce();
  Object.defineProperty(navigator, "onLine", { value: true }); window.dispatchEvent(new Event("online")); await tick(250);
  expect(mock.refresh).toHaveBeenCalledTimes(2);
});
it("cleans up timers, channel and listeners when navigating or switching branch", async () => {
  await render(); change(); await render("branch-b"); expect(mock.remove).toHaveBeenCalledOnce();
  await act(async () => root.render(null)); const calls = mock.refresh.mock.calls.length;
  window.dispatchEvent(new Event("focus")); await tick(30_000); expect(mock.refresh).toHaveBeenCalledTimes(calls);
  expect(mock.remove).toHaveBeenCalledTimes(2);
});
