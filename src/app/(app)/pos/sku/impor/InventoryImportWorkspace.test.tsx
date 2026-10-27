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

it("labels a posted master batch with rejected rows as partial completion", () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<InventoryImportWorkspace batches={[]} masterBatches={[{
    id: "saved-master-run", source_name: "sample.xlsx", status: "posted", rejectedCount: 3,
    progress: { phase: "selesai", completed: 100, total: 100, percentage: 100 },
  }]} masterError={null} recovered={null} initialReceipt={null} />));
  expect(host.textContent).toContain("selesai sebagian");
  expect(host.textContent).toContain("3 baris ditolak");
  expect(host.textContent).not.toContain("Master tercatat selesai;");
  expect(host.querySelector('a[href="/pos/sku/impor?master_run_id=saved-master-run"]')).not.toBeNull();
});

it("shows saved per-row failures with bounded navigation and no import retry", () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root?.render(<InventoryImportWorkspace batches={[]} masterBatches={[]}
    masterError={null} recovered={null} initialReceipt={null}
    masterReview={{runId:"saved-master-run",sourceName:"sample.xlsx",page:2,hasNext:true,error:null,
      rows:[{source_row:78,source_code:"SKU-78",source:"fixture-A.xlsx:78",reason:"Satuan tidak cocok"},
        {source_row:78,source_code:"SKU-78",source:"fixture-B.xlsx:78",reason:"Kategori tidak cocok"},
        {source_row:79,source_code:"SKU-79",source:null,reason:"Data lama"}]}} />));
  expect(host.textContent).toContain("Baris ditolak: sample.xlsx");
  expect(host.textContent).toContain("SKU-78");
  expect(host.textContent).toContain("Satuan tidak cocok");
  expect(host.textContent).toContain("fixture-A.xlsx:78");
  expect(host.textContent).toContain("fixture-B.xlsx:78");
  expect(host.textContent).toContain("Tidak tercatat pada batch lama");
  expect(host.querySelector('a[href="/pos/sku/impor?master_run_id=saved-master-run&master_page=1"]')).not.toBeNull();
  expect(host.querySelector('a[href="/pos/sku/impor?master_run_id=saved-master-run&master_page=3"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="master-import"]')).toBeNull();
});

const savedStock = { ok: true, phase: "preview" as const, message: "Batch tersimpan dipulihkan. Stok dan jurnal belum diposting; lanjutkan review OWNER.",
  branch_id: "fiction-branch", warehouse_id: "fiction-wh", as_of: "2026-01-01", run_id: "11111111-1111-4111-8111-111111111111",
  master_run_id: null, source_hash: "fiction-hash", rows: [], source_qty: 5, source_value: 50, checks: [], scope_clarification: null };

it("reopens a saved stock batch after navigating away and back, labelled by stage, without preparing again", () => {
  const batches = [
    { id: savedStock.run_id, source_name: "fiction.xlsx", status: "previewed", as_of_date: "2026-01-01" },
    { id: "22222222-2222-4222-8222-222222222222", source_name: "fiction-old.xlsx", status: "posted", as_of_date: null },
  ];
  for (let visit = 0; visit < 2; visit += 1) {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => root?.render(<InventoryImportWorkspace batches={batches} masterBatches={[]} masterError={null} recovered={savedStock} initialReceipt={null} />));
    expect(host.textContent).toContain("menunggu review OWNER; stok dan jurnal belum diposting");
    expect(host.textContent).toContain("Stok sudah diposting");
    expect(host.textContent).toContain("tanpa tanggal");
    expect(host.textContent).not.toMatch(/· previewed ·|· posted ·/);
    expect(host.textContent).toContain("File di browser tidak ikut tersimpan");
    expect(host.querySelector(`a[href="/keuangan/persediaan-awal?run_id=${savedStock.run_id}"]`)).not.toBeNull();
    expect(host.querySelector('[data-testid="stock-import"]')).toBeNull();
    act(() => root?.unmount()); root = null; host.remove();
  }
});

it("distinguishes a posted batch from a prepared one on recovery", () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root?.render(<InventoryImportWorkspace batches={[]} masterBatches={[]} masterError={null} initialReceipt={null}
    recovered={{ ...savedStock, phase: "done", message: "Batch sudah diposting. Buka bukti posting di Keuangan / Persediaan Awal." }} />));
  expect(host.textContent).toContain("sudah diposting");
  expect(host.textContent).not.toContain("menunggu review OWNER");
});

it("discloses a failed batch recovery instead of showing a review link", () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root?.render(<InventoryImportWorkspace batches={[]} masterBatches={[]} masterError={null} initialReceipt={null}
    recovered={{ ...savedStock, ok: false, run_id: null, message: "Batch tidak dapat diakses atau belum lengkap." }} />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("tidak dapat diakses");
  expect(host.querySelector('a[href*="persediaan-awal"]')).toBeNull();
});
