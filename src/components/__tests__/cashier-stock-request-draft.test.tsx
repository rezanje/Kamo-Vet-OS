// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const action = vi.hoisted(() => vi.fn<(data: FormData) => Promise<void>>(async () => {}));
vi.mock("@/app/kasir/persediaan/actions", () => ({ buatPermintaanKasir: action }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
import { PersediaanBaruForm } from "@/app/kasir/persediaan/baru/PersediaanBaruForm";
import { transactionDraftName } from "@/components/TransactionDraft";

const item = { id: "item-a", code: "A", name: "Obat A", unit: "pcs", kategori: "Obat", stok: 0,
  units: [{ unit: "pcs", factor: 1, sell_price: 10, buy_price: 5 }, { unit: "box", factor: 10, sell_price: 100, buy_price: 50 }] };
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear(); action.mockReset(); action.mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(userId = "user-a", branchId = "branch-a") {
  await act(async () => root.render(<PersediaanBaruForm userId={userId} branchId={branchId} branchName={branchId}
    warehouses={[{ id: "dc-a", name: "DC Pusat" }]} items={[item]} userName={userId} />));
}
async function remount() { await act(async () => root.unmount()); root = createRoot(host); }
async function edit(control: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function fill() {
  await edit(host.querySelector<HTMLSelectElement>('select[name="to_warehouse_id"]')!, "dc-a");
  await edit(host.querySelector<HTMLSelectElement>('select[name="priority"]')!, "tinggi");
  await edit(host.querySelector<HTMLInputElement>('input[name="catatan"]')!, "Stok minggu ini");
  await act(async () => Array.from(host.querySelectorAll("button")).find(b => b.textContent?.includes("Tambah Barang"))!.click());
  await edit(host.querySelector<HTMLSelectElement>("tbody select")!, "item-a");
  await edit(host.querySelectorAll<HTMLSelectElement>("tbody select")[1], "box");
  await edit(host.querySelector<HTMLInputElement>('input[type="number"]')!, "3");
  await edit(host.querySelector<HTMLInputElement>('input[placeholder="mis. stok menipis"]')!, "stok menipis");
}
const payload = () => host.querySelector<HTMLInputElement>('input[name="items"]')!.value;
const identity = () => host.querySelector<HTMLInputElement>('input[name="request_key"]');

it("restores request lines, selected units, destination and notes after a rejected save and reload", async () => {
  await render(); await fill();
  expect(identity()).not.toBeNull();
  const key = identity()!.value;
  expect(key).toMatch(/^[0-9a-f-]{36}$/i);
  const expected = payload();
  action.mockRejectedValueOnce(new Error("offline"));
  await act(async () => host.querySelector("form")!.requestSubmit());
  expect(host.textContent).toContain("Respons simpan belum terkonfirmasi");
  expect(payload()).toBe(expected);
  await remount(); await render();
  expect(payload()).toBe(expected); expect(identity()!.value).toBe(key);
  expect(host.querySelector<HTMLSelectElement>('select[name="to_warehouse_id"]')!.value).toBe("dc-a");
  expect(host.querySelector<HTMLSelectElement>('select[name="priority"]')!.value).toBe("tinggi");
  expect(host.querySelector<HTMLInputElement>('input[name="catatan"]')!.value).toBe("Stok minggu ini");
});

it("keeps the pending draft after unconfirmed resolution and clears only its exact success acknowledgement", async () => {
  await render(); await fill();
  expect(identity()).not.toBeNull();
  const key = identity()!.value, expected = payload(), scope = "cashier-stock-request:branch-a";
  const name = transactionDraftName("user-a", "transaction", scope);
  await act(async () => host.querySelector("form")!.requestSubmit());
  expect(payload()).toBe(expected); expect(sessionStorage.getItem(name)).not.toBeNull();
  await act(async () => window.dispatchEvent(new CustomEvent("vetos:transaction-confirmed", { detail: { scope, key: "another-save" } })));
  expect(payload()).toBe(expected); expect(sessionStorage.getItem(name)).not.toBeNull();
  await act(async () => window.dispatchEvent(new CustomEvent("vetos:transaction-confirmed", { detail: { scope, key } })));
  expect(payload()).toBe("[]"); expect(sessionStorage.getItem(name)).toBeNull();
  expect(identity()!.value).not.toBe(key);
  expect(host.querySelector<HTMLSelectElement>('select[name="to_warehouse_id"]')!.value).toBe("");
  expect(host.querySelector<HTMLInputElement>('input[name="catatan"]')!.value).toBe("");
});

it("isolates drafts across users and branches, including a mounted context change", async () => {
  await render(); await fill(); const expected = payload();
  await render("user-b"); expect(payload()).toBe("[]");
  expect(host.querySelector<HTMLInputElement>('input[name="catatan"]')!.value).toBe("");
  await render("user-a", "branch-b"); expect(payload()).toBe("[]");
  await render(); expect(payload()).toBe(expected);
});

it("keeps unsaved lines available when storage is blocked and prevents an untracked submission", async () => {
  const broken = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  try {
    await render(); await fill();
    expect(identity()).not.toBeNull(); expect(identity()!.value).toBe("");
    expect(host.textContent).toContain("Draf browser tidak dapat disimpan");
    expect(payload()).toContain("item-a");
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  } finally { broken.mockRestore(); }
});
