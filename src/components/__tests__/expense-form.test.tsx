// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ save: vi.fn(), recover: vi.fn(), hasShift: true }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/app/kasir/pengeluaran/actions", () => ({ simpanPengeluaranKasir: fixture.save }));
vi.mock("@/app/(app)/pos/expense/actions", () => ({ periksaExpense: fixture.recover }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => fixture.hasShift ? ({ id: "shift", branch_id: "branch", branchName: "Cabang" }) : null }));
vi.mock("@/components/LampiranPicker", () => ({ LampiranPicker: () => <input type="hidden" name="lampiran" data-draft-state defaultValue="[]" /> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => {
  const query = { select: () => query, eq: () => query, gte: () => query, order: () => query, limit: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [] }).then(resolve) };
  return { from: () => query, auth: { getUser: async () => ({ data: { user: { id: "cashier" } } }) } };
} }));

import PengeluaranKasirPage from "@/app/kasir/pengeluaran/page";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); fixture.hasShift = true; sessionStorage.clear(); window.history.replaceState(null, "", "/");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render(params: Record<string, string> = {}) { const page = await PengeluaranKasirPage({ searchParams: Promise.resolve(params) }); await act(async () => root.render(page)); }
async function edit(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[name="jumlah"]')!;
  await act(async () => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); });
}

it("retains the same financial retry identity and amount across reload", async () => {
  await render(); await edit("25000");
  const key = host.querySelector<HTMLInputElement>('input[name="request_key"]')?.value;
  expect(key).toBeTruthy();
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value).toBe(key);
  expect(host.querySelector<HTMLInputElement>('input[name="jumlah"]')!.value).toBe("25000");
});

it("disables saving while a submission is pending", async () => {
  let finish!: () => void; fixture.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await render();
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await act(async () => finish());
});

it("preserves amount and identity after an unconfirmed save", async () => {
  fixture.save.mockRejectedValueOnce(Error("network")); await render(); await edit("25000");
  const key = host.querySelector<HTMLInputElement>('input[name="request_key"]')?.value;
  expect(key).toBeTruthy();
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(host.textContent).toContain("Isian tetap tersedia");
  expect(host.querySelector<HTMLInputElement>('input[name="jumlah"]')!.value).toBe("25000");
  expect(host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value).toBe(key);
});

it("retires an acknowledged request after a full page navigation", async () => {
  await render(); await edit("25000");
  const key = host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
  await act(async () => root.unmount()); root = createRoot(host);
  window.history.replaceState(null, "", `/?draft_scope=cashier-expense%3Ashift&draft_done=${key}`);
  await render();
  expect(host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value).not.toBe(key);
  expect(host.querySelector<HTMLInputElement>('input[name="jumlah"]')!.value).toBe("");
});

it("offers precise-key recovery after a committed response is lost", async () => {
  fixture.save.mockRejectedValueOnce(Error("network")); await render(); await edit("25000");
  const key = host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  const recover = Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("Periksa Hasil Simpan"));
  expect(recover).toBeDefined();
  await act(async () => host.querySelector("form")!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: recover! })));
  expect(fixture.recover).toHaveBeenCalledTimes(1);
  expect((fixture.recover.mock.calls[0][0] as FormData).get("request_key")).toBe(key);
});

it("keeps the last attempted expense recoverable after its shift closes", async () => {
  fixture.save.mockRejectedValueOnce(Error("network")); await render(); await edit("25000");
  const key = host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => root.unmount()); root = createRoot(host); fixture.hasShift = false;
  const page = PengeluaranKasirPage({ searchParams: Promise.resolve({}) });
  await expect(page).resolves.toBeDefined();
  await act(async () => root.render(await page));
  expect(host.textContent).toContain("Periksa Hasil Simpan");
  expect(host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value).toBe(key);
  expect(host.querySelector<HTMLAnchorElement>('a[href="/kasir/mulai"]')).toBeTruthy();
});

it("keeps fields visible but blocks monetary save when the retry identity cannot be stored", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("Storage unavailable"); });
  await render(); await edit("25000");
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(host.textContent).toContain("Penyimpanan browser tidak tersedia");
  expect(host.querySelector<HTMLInputElement>('input[name="jumlah"]')!.value).toBe("25000");
  expect(fixture.save).not.toHaveBeenCalled();
});
