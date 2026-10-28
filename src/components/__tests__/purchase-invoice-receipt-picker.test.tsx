// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/pembelian/faktur/actions", () => ({ buatFaktur: vi.fn() }));
import { FakturForm, type PoOption } from "@/app/(app)/pembelian/faktur/baru/FakturForm";

const options: PoOption[] = [{
  id: "po1", label: "PO 1", terminHari: 30, warning: null,
  items: [{ po_item_id: "line1", item_id: "item1", nama: "Obat", harga_po: 100, sisa: 10, satuan: "box", faktor: 10, blockedReason: null }],
  receipts: [
    { id: "gr1", no_terima: "TB.1", tanggal: "2026-10-01", ringkas: "Obat 4 box", sudahDifaktur: null },
    { id: "gr2", no_terima: "TB.2", tanggal: "2026-10-02", ringkas: "Obat 6 box", sudahDifaktur: null },
    { id: "gr0", no_terima: "TB.0", tanggal: "2026-09-30", ringkas: "Obat 1 box", sudahDifaktur: "FB.9" },
  ],
}];
let container: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const chosen = () => JSON.parse(container.querySelector<HTMLInputElement>('input[name="receipt_ids"]')!.value);
const submit = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Simpan faktur"))!;

it("N01: picking a PO pre-selects its receipts not yet invoiced; an invoiced one cannot be chosen", async () => {
  await act(async () => root.render(<FakturForm userId="owner" options={options} />));
  const select = container.querySelector("select")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "po1"); select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(chosen()).toEqual(["gr1", "gr2"]);
  expect(container.textContent).toContain("sudah ditagih di faktur FB.9");
  const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(boxes.find((b) => b.closest("label")?.textContent?.includes("TB.0"))!.disabled).toBe(true);
  await act(async () => { boxes.find((b) => b.closest("label")?.textContent?.includes("TB.2"))!.click(); });
  expect(chosen()).toEqual(["gr1"]);
  await act(async () => { boxes.find((b) => b.closest("label")?.textContent?.includes("TB.1"))!.click(); });
  expect(chosen()).toEqual([]);
  expect(submit().disabled).toBe(true);
  expect(container.textContent).toContain("Pilih minimal satu penerimaan");
});

it("N01: a replacement invoice offers the voided invoice's stored receipts again", async () => {
  await act(async () => root.render(<FakturForm userId="owner" options={options} initial={{
    id: "old", po_id: "po1", tanggal: "2026-10-03", jatuh_tempo: "2026-11-03", no_faktur_pemasok: null, keterangan: null,
    receipt_ids: ["gr2", "gr0"], purchase_invoice_items: [{ po_item_id: "line1", qty: 6, harga: 100 }],
  }} />));
  expect(chosen()).toEqual(["gr2"]);
});
