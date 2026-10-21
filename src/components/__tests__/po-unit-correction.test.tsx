// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/pembelian/actions", () => ({ ubahPO: vi.fn(), batalkanPO: vi.fn() }));
import { POEditForm } from "@/app/(app)/pembelian/[id]/POCorrectionForm";
it("corrects unit and base-cost preview together with quantity and purchase price", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<POEditForm userId="owner" poId="po" revision={0} supplierId="" warehouseId="w" tanggal="2026-10-21" suppliers={[]} warehouses={[{ id: "w", name: "Gudang" }]} rows={[{ id: "line", item_id: "item", nama: "Obat", qty: 2, harga_beli: 1000, satuan: "pcs", faktor: 1 }]} unitOptions={{ item: [{ unit: "pcs", factor: 1, buy_price: 100, sell_price: 200 }, { unit: "box", factor: 10, buy_price: 1000, sell_price: 2000 }] }} />));
    const selector = host.querySelector<HTMLSelectElement>('select[aria-label="Satuan item 1"]');
    expect(selector).not.toBeNull();
    await act(async () => { selector!.value = "box"; selector!.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(JSON.parse(String(new FormData(host.querySelector("form")!).get("items")))[0]).toMatchObject({ satuan: "box", faktor: 10, harga_beli: 1000 });
    expect(host.textContent).toContain("20 pcs");
    expect(host.textContent).toContain("Rp 100/pcs");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
