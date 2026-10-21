// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
import { DraftUserProvider } from "@/components/LocalTransactionDraft";
import { transactionDraftName } from "@/components/TransactionDraft";
import { TerimaForm } from "@/app/kasir/persediaan/terima/[id]/TerimaForm";

const items = [
  { id: "line-a", item_id: "item-a", nama: "Obat A", qty_diminta: 4, qty_disetujui: 3, satuan: "pcs" },
  { id: "line-b", item_id: "item-b", nama: "Obat B", qty_diminta: 2, qty_disetujui: 2, satuan: "pcs" },
];
const catalog = [
  { id: "item-a", code: "A", name: "Obat A", unit: "pcs", upc: null, kategori: "Obat" },
  { id: "item-b", code: "B", name: "Obat B", unit: "pcs", upc: null, kategori: "Obat" },
];
const replacementItems = [{ id: "line-c", item_id: "item-c", nama: "Obat C", qty_diminta: 5, qty_disetujui: 5, satuan: "pcs" }];
const replacementCatalog = [{ id: "item-c", code: "C", name: "Obat C", unit: "pcs", upc: null, kategori: "Obat" }];
let root: Root, host: HTMLDivElement;
const action = vi.fn<(data: FormData) => Promise<void>>();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear(); action.mockReset(); action.mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function render(userId = "user-a", requestId = "request-a", formItems = items, formCatalog = catalog) {
  await act(async () => root.render(<DraftUserProvider userId={userId}><TerimaForm requestId={requestId} noRequest="PRM-1" whName="DC" userName="Kasir" items={formItems} catalog={formCatalog} action={action} /></DraftUserProvider>));
}

it("restores received quantities after an uncertain save and remount", async () => {
  await render();
  const qty = host.querySelector<HTMLInputElement>('input[type="number"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(qty, "1");
  await act(async () => qty.dispatchEvent(new Event("input", { bubbles: true })));
  const key = host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
  expect(key).toMatch(/^[0-9a-f-]{36}$/i);
  action.mockRejectedValueOnce(new Error("offline"));
  await act(async () => host.querySelector("form")!.requestSubmit());
  expect(host.textContent).toContain("Respons simpan belum terkonfirmasi");
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(host.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("1");
  expect(host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value).toBe(key);
});

it("reconciles a malformed draft back to every original request line", async () => {
  const key = "f1000000-0000-4000-8000-000000000001";
  sessionStorage.setItem(transactionDraftName("user-a", "transaction", "cashier-stock-receipt:request-a"), JSON.stringify({
    version: 1, savedAt: Date.now(), requestKey: key,
    fields: {}, snapshot: { rows: [{ ...items[0], qty_diterima: 1, kondisi: "baik", notes: "disimpan" }, { id: "extra", item_id: "foreign", nama: "Bukan permintaan", qty_diminta: 9, qty_diterima: 9, kondisi: "baik", notes: "" }] },
  }));
  await render();
  const payload = JSON.parse(host.querySelector<HTMLInputElement>('input[name="items"]')!.value) as { id: string; qty_diterima: number }[];
  expect(payload.map(row => row.id)).toEqual(["line-a", "line-b"]);
  expect(payload[0].qty_diterima).toBe(1);
  expect(payload[1].qty_diterima).toBe(0);
  expect(host.textContent).toContain("disesuaikan");
  expect(host.querySelector('button[title="Hapus"]')).toBeNull();
});

it("clears the active identity while request or user context changes", async () => {
  await render();
  const key = host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
  expect(key).toMatch(/^[0-9a-f-]{36}$/i);
  const note = host.querySelector<HTMLInputElement>('input[name="catatan"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(note, "catatan lama");
  await act(async () => note.dispatchEvent(new Event("input", { bubbles: true })));
  await render("user-a", "request-b", replacementItems, replacementCatalog);
  const replacementKey = host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
  expect(replacementKey).toMatch(/^[0-9a-f-]{36}$/i);
  expect(replacementKey).not.toBe(key);
  expect(host.textContent).toContain("Obat C");
  expect(host.textContent).not.toContain("Obat A");
  expect(host.querySelector<HTMLInputElement>('input[name="catatan"]')!.value).toBe("");
  await render("user-b", "request-b", replacementItems, replacementCatalog);
  const userKey = host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
  expect(userKey).toMatch(/^[0-9a-f-]{36}$/i);
  expect(userKey).not.toBe(replacementKey);
  expect(host.querySelector<HTMLInputElement>('input[name="catatan"]')!.value).toBe("");
});
