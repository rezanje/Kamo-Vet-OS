// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/penjualan/retur/corrections", () => ({ correctReturn: vi.fn() }));
import { ReturnCorrectionForm } from "@/components/returns/ReturnCorrectionForm";

let root: Root, host: HTMLDivElement;
const view = () => <ReturnCorrectionForm userId="owner" kind="sales" id="return" revision={0} rows={[
  { id: "line", source_line_id: "source", item_id: "item", nama: "Barang", selected_qty: 5, satuan: "pcs", kondisi: "baik" },
]} />;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function edit(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("restores actual quantity, evidence, reason and stable identity after remount", async () => {
  await act(async () => root.render(view()));
  const key = host.querySelector<HTMLInputElement>('input[name="requestKey"]')!.value;
  await edit(host.querySelector<HTMLInputElement>('input[type="number"]')!, "3");
  await edit(host.querySelector<HTMLTextAreaElement>('[name="physical_evidence"]')!, "TEST-3 signed receipt three");
  await edit(host.querySelector<HTMLTextAreaElement>('[name="reason"]')!, "Wrong quantity");
  await act(async () => root.unmount()); root = createRoot(host);
  await act(async () => root.render(view()));
  expect(host.querySelector<HTMLInputElement>('input[name="requestKey"]')!.value).toBe(key);
  expect(host.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("3");
  expect(host.querySelector<HTMLTextAreaElement>('[name="physical_evidence"]')!.value).toBe("TEST-3 signed receipt three");
  expect(host.querySelector<HTMLTextAreaElement>('[name="reason"]')!.value).toBe("Wrong quantity");
  expect(JSON.parse(host.querySelector<HTMLInputElement>('[name="items"]')!.value)[0].qty).toBe(3);
});
it("explicitly cancels with zero goods and requires checked physical evidence", async () => {
  await act(async () => root.render(view()));
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(host.querySelector<HTMLInputElement>('[name="items"]')!.value).toBe("[]");
  expect(host.querySelector<HTMLInputElement>('[name="physical_checked"]')!.required).toBe(true);
  expect(host.textContent).toContain("tidak melakukan pengiriman, refund, atau transfer bank");
});
