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
  act(() => root?.render(<InventoryImportWorkspace batches={[]} masterBatches={[]} masterError={null} recovered={null} initialReceipt={null} />));

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

it("shows the last saved master status after a new page mount without offering an automatic retry", () => {
  const masterBatches = [{
    id: "saved-master-run", source_name: "sample.xlsx", status: "previewed",
    progress: { phase: "mengimpor" as const, completed: 40, total: 100, percentage: 40 },
  }];
  for (let visit = 0; visit < 2; visit += 1) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<InventoryImportWorkspace batches={[]} masterBatches={masterBatches} masterError={null} recovered={null} initialReceipt={null} />));
    expect(host.textContent).toContain("sample.xlsx");
    expect(host.textContent).toContain("40/100");
    expect(host.textContent).toContain("belum terkonfirmasi selesai");
    expect(host.querySelector('[data-testid="master-import"]')).toBeNull();
    expect(host.querySelector('a[href*="saved-master-run"]')).toBeNull();
    act(() => root?.unmount());
    root = null;
    host.remove();
  }
});

it("discloses a failed master-batch read instead of claiming there are no saved batches", () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<InventoryImportWorkspace batches={[]} masterBatches={[]} masterError="fixture read error" recovered={null} initialReceipt={null} />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("fixture read error");
  expect(host.textContent).not.toContain("Belum ada batch master");
});
