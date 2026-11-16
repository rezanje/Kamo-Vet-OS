// @vitest-environment jsdom
// Kasus 13 Nov: PO diubah (225 ML @222,225 → 5 BTL @10.000) saat draf faktur lama masih di tab.
// Draf lama tidak boleh mengisi ulang qty/harga baris yang satuannya sudah berubah.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/pembelian/faktur/actions", () => ({ buatFaktur: vi.fn() }));
import { FakturForm, poDraftSignature, type PoOption } from "@/app/(app)/pembelian/faktur/baru/FakturForm";
import { transactionDraftName } from "@/components/TransactionDraft";

let root: Root; let host: HTMLDivElement;
const line = (over: Partial<PoOption["items"][number]>): PoOption["items"][number] => ({
  po_item_id: "line-vitc", item_id: "vitc", nama: "Vitamin C", harga_po: 222.225, sisa: 225, satuan: "ML", faktor: 1, blockedReason: null, ...over,
});
const po = (items: PoOption["items"]): PoOption => ({ id: "po", label: "PO-1", terminHari: 30, warning: null, receipts: [], items });
const before = po([line({})]);
const after = po([line({ harga_po: 10000, sisa: 5, satuan: "BTL", faktor: 45 })]);
const render = (options: PoOption[]) => act(async () => root.render(<FakturForm options={options} userId="owner" />));
const form = () => new FormData(host.querySelector("form")!);

beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function withDraftFrom(saved: PoOption, current: PoOption) {
  await render([current]);
  const key = String(form().get("draft_key"));
  expect(key).toBeTruthy();
  sessionStorage.setItem(transactionDraftName("owner", "transaction", "invoice"), JSON.stringify({
    version: 1, savedAt: Date.now() - 1000, requestKey: key, fields: {},
    snapshot: { poId: "po", poSig: poDraftSignature(saved), qty: { "line-vitc": saved.items[0].sisa }, harga: { "line-vitc": saved.items[0].harga_po }, tempo: "2026-12-10", receiptIds: [] },
  }));
  await act(async () => root.unmount()); root = createRoot(host);
  await render([current]);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

it("tidak memulihkan qty/harga lama setelah PO diubah", async () => {
  await withDraftFrom(before, after);
  expect(host.textContent).toContain("Draf lama tidak dapat dipulihkan");
  expect(JSON.parse(String(form().get("items")))).toEqual([]);
  expect(String(form().get("items"))).not.toContain("222.225");
});

it("tetap memulihkan draf bila PO tidak berubah", async () => {
  await withDraftFrom(after, after);
  expect(host.textContent).toContain("Draf dipulihkan");
  expect(JSON.parse(String(form().get("items")))).toEqual([{ po_item_id: "line-vitc", qty: 5, harga: 10000 }]);
});
