// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SearchableItemPicker } from "@/components/SearchableItemPicker";

let host: HTMLDivElement;
let root: Root;
const items = Array.from({ length: 1205 }, (_, index) => ({ id: `item-${index}`, code: `SKU-${index}`, name: `Produk ${index}` }));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("searches code and name across the complete catalog", async () => {
  let selected = "";
  await act(async () => root.render(<SearchableItemPicker items={items} value={selected} onChange={(id) => { selected = id; }} />));
  const input = host.querySelector<HTMLInputElement>("input")!;
  await act(async () => { input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "SKU-1204"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(host.textContent).toContain("SKU-1204 · Produk 1204");
  expect(host.textContent).not.toContain("SKU-4 · Produk 4");
  await act(async () => (host.querySelector<HTMLButtonElement>('button[role="option"]')!).click());
  expect(selected).toBe("item-1204");
});

it("syncs restored and cleared values, and selects with keyboard without submitting", async () => {
  let selected = "item-1204";
  const onChange = (id: string) => { selected = id; };
  await act(async () => root.render(<SearchableItemPicker items={items} value={selected} onChange={onChange} />));
  const input = host.querySelector<HTMLInputElement>("input")!;
  expect(input.value).toBe("SKU-1204 · Produk 1204");
  selected = "item-1001";
  await act(async () => root.render(<SearchableItemPicker items={items} value={selected} onChange={onChange} />));
  expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("SKU-1001 · Produk 1001");
  selected = "";
  await act(async () => root.render(<SearchableItemPicker items={items} value={selected} onChange={onChange} />));
  const restoredInput = host.querySelector<HTMLInputElement>("input")!;
  await act(async () => { restoredInput.focus(); restoredInput.dispatchEvent(new Event("focus", { bubbles: true })); });
  expect(restoredInput.getAttribute("aria-expanded")).toBe("true");
  await act(async () => { restoredInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true })); });
  await act(async () => { restoredInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true })); });
  expect(selected).toBe("item-0");
  await act(async () => { restoredInput.focus(); restoredInput.blur(); await new Promise((resolve) => setTimeout(resolve, 120)); });
  expect(restoredInput.getAttribute("aria-expanded")).toBe("false");
  selected = "";
  await act(async () => root.render(<SearchableItemPicker items={items} value={selected} onChange={onChange} />));
  expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("");
});
