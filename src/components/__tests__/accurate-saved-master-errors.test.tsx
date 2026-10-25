import React from "react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ bolehKelolaMaster: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/master-guard", () => ({ bolehKelolaMaster: mocks.bolehKelolaMaster }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/app/(app)/pos/sku/impor/actions", () => ({ recoverInitialStock: vi.fn() }));
import ImporBarangPage from "@/app/(app)/pos/sku/impor/page";
import { InventoryImportWorkspace } from "@/app/(app)/pos/sku/impor/InventoryImportWorkspace";

const runId = "ec100000-0000-4000-8000-000000000001";
const run = { id: runId, source_name: "fiction.xlsx", status: "posted", summary: { Ditolak: 51 } };
function workspace(element: React.ReactNode): React.ReactElement<React.ComponentProps<typeof InventoryImportWorkspace>> {
  if (React.isValidElement(element)) {
    if (element.type === InventoryImportWorkspace) return element as React.ReactElement<React.ComponentProps<typeof InventoryImportWorkspace>>;
    const children = (element.props as { children?: React.ReactNode }).children;
    for (const child of React.Children.toArray(children)) {
      const found = workspaceOrNull(child);
      if (found) return found;
    }
  }
  throw new Error("Import workspace was not rendered");
}
function workspaceOrNull(element: React.ReactNode): React.ReactElement<React.ComponentProps<typeof InventoryImportWorkspace>> | null {
  try { return workspace(element); } catch { return null; }
}

function client(rows = Array.from({ length: 51 }, (_, i) => ({ id: i + 1, source_row: i + 2, source_code: `F-${i}`, reason: `Rejected ${i}`, payload: {source:`fixture-${i % 2 ? "B" : "A"}.xlsx:${i + 2}`} })), rowError: { message: string } | null = null) {
  const rowQuery = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn() };
  rowQuery.select.mockReturnValue(rowQuery); rowQuery.eq.mockReturnValue(rowQuery); rowQuery.order.mockReturnValue(rowQuery);
  rowQuery.range.mockResolvedValue({ data: rowError ? null : rows, error: rowError });
  const db = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "fiction-owner" } } }) },
    from: vi.fn((table: string) => {
      if (table === "import_run_rows") return rowQuery;
      const q = { kind: "", select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() };
      q.select.mockReturnValue(q); q.eq.mockImplementation((field: string, value: string) => { if (field === "kind") q.kind = value; return q; });
      q.order.mockReturnValue(q); q.limit.mockImplementation(async () => ({ data: q.kind === "master_accurate" ? [run] : [], error: null }));
      return q;
    }),
  };
  mocks.createClient.mockResolvedValue(db);
  return { db, rowQuery };
}

beforeEach(() => { mocks.bolehKelolaMaster.mockReset().mockResolvedValue(true); mocks.createClient.mockReset(); });

it("reads one bounded page of rejected rows only for a selected account batch", async () => {
  const { rowQuery } = client();
  const ui = workspace(await ImporBarangPage({ searchParams: Promise.resolve({ master_run_id: runId, master_page: "1" }) }));
  expect(rowQuery.eq.mock.calls).toEqual([["run_id", runId], ["status", "rejected"]]);
  expect(rowQuery.select).toHaveBeenCalledWith("id,source_row,source_code,reason,payload");
  expect(rowQuery.range).toHaveBeenCalledWith(0, 50);
  expect(ui.props.masterReview?.rows).toHaveLength(50);
  expect(ui.props.masterReview?.hasNext).toBe(true);
  expect(ui.props.masterReview?.rows[0].reason).toBe("Rejected 0");
  expect(ui.props.masterReview?.rows[0].source).toBe("fixture-A.xlsx:2");
});

it("never reads rows for a batch absent from the account's list", async () => {
  const { db } = client();
  const ui = workspace(await ImporBarangPage({ searchParams: Promise.resolve({ master_run_id: "ec100000-0000-4000-8000-000000000002" }) }));
  expect(db.from).not.toHaveBeenCalledWith("import_run_rows");
  expect(ui.props.masterReview?.error).toContain("tidak dapat diakses");
});

it("paginates rejected rows without changing the selected batch", async () => {
  const { rowQuery } = client([{id:51,source_row:78,source_code:"F-78",reason:"Fixture mismatch",payload:{source:"fixture-B.xlsx:78"}}]);
  const ui = workspace(await ImporBarangPage({ searchParams: Promise.resolve({ master_run_id: runId, master_page: "2" }) }));
  expect(rowQuery.range).toHaveBeenCalledWith(50, 100);
  expect(ui.props.masterReview?.page).toBe(2);
  expect(ui.props.masterReview?.rows[0].source_row).toBe(78);
  expect(ui.props.masterReview?.hasNext).toBe(false);
});

it("does not query pages beyond the saved rejected-row count", async () => {
  const { db } = client();
  const ui = workspace(await ImporBarangPage({ searchParams: Promise.resolve({ master_run_id: runId, master_page: "99999" }) }));
  expect(db.from).not.toHaveBeenCalledWith("import_run_rows");
  expect(ui.props.masterReview?.error).toContain("tidak tersedia");
});

it("fails closed when rejected-row details cannot be read", async () => {
  client([], { message: "fictional read failure" });
  const ui = workspace(await ImporBarangPage({ searchParams: Promise.resolve({ master_run_id: runId }) }));
  expect(ui.props.masterReview?.error).toContain("belum dapat dimuat");
  expect(ui.props.masterReview?.rows).toHaveLength(0);
});

it("does not claim an empty result when saved rejected rows are missing", async () => {
  client([]);
  const ui = workspace(await ImporBarangPage({ searchParams: Promise.resolve({ master_run_id: runId }) }));
  expect(ui.props.masterReview?.error).toContain("tidak cocok");
  expect(ui.props.masterReview?.rows).toHaveLength(0);
  expect(ui.props.masterReview?.hasNext).toBe(false);
});
