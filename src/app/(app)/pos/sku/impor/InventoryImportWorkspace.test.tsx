// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("./AccurateImportForm", () => ({ AccurateImportForm: () => <div data-testid="master-import">Master import controls</div> }));
vi.mock("./StockOnlyImport", () => ({
  StockOnlyImport: () => <div data-testid="stock-import">Stock only controls</div>,
  StockValuation: () => null,
}));

import { InventoryImportWorkspace } from "./InventoryImportWorkspace";

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

it("requires an explicit import mode before showing a category-changing master upload", () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<InventoryImportWorkspace batches={[]} recovered={null} initialReceipt={null} />));

  const mode = host.querySelector<HTMLSelectElement>('select[aria-label="Mode impor"]');
  expect(mode?.value).toBe("");
  expect(host.querySelector('[data-testid="master-import"]')).toBeNull();
  expect(host.querySelector('[data-testid="stock-import"]')).toBeNull();

  act(() => {
    if (mode) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(mode, "stock_only");
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  expect(host.querySelector('[data-testid="stock-import"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="master-import"]')).toBeNull();

  act(() => {
    if (mode) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(mode, "master");
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  expect(host.querySelector('[data-testid="master-import"]')).not.toBeNull();
});
