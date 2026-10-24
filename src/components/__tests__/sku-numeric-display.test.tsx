// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("@/app/(app)/pos/sku/actions", () => ({ simpanBarang: vi.fn() }));
import { BarangForm, type BarangRow } from "@/app/(app)/pos/sku/BarangForm";

it("shows grouped SKU prices without changing the submitted base, tier or unit numbers", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const editing = { id:"test", name:"Test", unit:"PCS", item_type:"Persediaan", sell_price:15000.125, buy_price:1000000,
    units:[{unit:"DUS",factor:24,sell_price:240000,buy_price:120000}], tiers:[{min_qty:12,harga:14000}], min_stock:0,
    min_buy:0,min_sell_qty:0,default_discount:0,is_active:true } as BarangRow;
  try {
    await act(async () => root.render(<BarangForm editing={editing} categories={[]} brands={[]} satuanMaster={[{id:"pcs",nama:"PCS"},{id:"dus",nama:"DUS"}]} />));
    expect(host.querySelector('[data-number-display="sell_price"]')?.textContent).toBe("15.000,125");
    const data = new FormData(host.querySelector("form")!);
    expect(data.get("sell_price")).toBe("15000.125");
    expect(data.get("buy_price")).toBe("1000000");
    expect(JSON.parse(String(data.get("units")))).toEqual(editing.units);
    expect(JSON.parse(String(data.get("tiers")))).toEqual(editing.tiers);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
