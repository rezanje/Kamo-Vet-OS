import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";
import { loadOpnamePriceReport, opnameFilters, opnameSummary } from "../opname-price-report";

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
import { GET } from "@/app/(app)/laporan/hasil-opname/unduh/route";

const ORDER = "ec500000-0000-4000-8000-000000000001";
const RESULT = "ec500000-0000-4000-8000-000000000002";
const itemA = "ec500000-0000-4000-8000-000000000003";
const itemB = "ec500000-0000-4000-8000-000000000004";
const period = { dari: "2026-10-01", sampai: "2026-10-31", order: ORDER };
const snapshot = { version: 1, method: "fifo", scope: "Sebagian", branch_id: "b1", warehouse_id: "w1", correction_revision: null,
  rows: [
    { item_id: itemA, code: "I05-A", name: "=SUM(1,1)", unit: "PCS", qty_sistem: 10, qty_fisik: 8, selisih: -2,
      qty_stok_setelah: 8, nilai_lapisan_setelah: "1300", modal_satuan: "100", sumber_modal: "HPP FIFO selisih keluar per unit",
      hpp_selisih_keluar: "200", nilai_selisih_modal: "-200", sumber_nilai_modal: "HPP FIFO keluar yang dijurnal",
      harga_jual_cabang: "0", nilai_selisih_jual: "0" },
    { item_id: itemB, code: "I05-B", name: "Bahan B", unit: "PCS", qty_sistem: 0, qty_fisik: 2, selisih: 2,
      qty_stok_setelah: 2, nilai_lapisan_setelah: "100", modal_satuan: "50", sumber_modal: "Biaya masuk/acuan PO yang dijurnal per unit",
      hpp_selisih_keluar: null, nilai_selisih_modal: "100", sumber_nilai_modal: "Biaya masuk dari acuan PO yang dijurnal",
      harga_jual_cabang: "70", nilai_selisih_jual: "140" },
  ] };

function fixture(options: { role?: string; active?: boolean; snapshot?: unknown; deniedBranch?: string; resultCount?: number; errorTable?: string; otherBranch?: boolean;
  journals?: Record<string, unknown>[] } = {}) {
  const rows = Array.from({ length: options.resultCount ?? 1 }, (_, n) => ({ id: n ? `result-${n}` : RESULT, order_id: ORDER,
    no_hasil: n ? `OPR-${n}` : "OPR-I05", tanggal: "2026-10-25",
    opname_orders: { no_opname: "OPO-I05", warehouse_id: "w1", warehouses: { name: "VET", branch_id: "b1" } } }));
  if (options.otherBranch) rows.push({ id: "other-result", order_id: "other-order", no_hasil: "OPR-OTHER", tanggal: "2026-10-25",
    opname_orders: { no_opname: "OPO-OTHER", warehouse_id: "w2", warehouses: { name: "OTHER", branch_id: "b2" } } });
  const base = clientFixture({ role: options.role, active: options.active, deniedBranch: options.deniedBranch, errorTable: options.errorTable,
    tables: { opname_results: rows, warehouses: [{ id: "w1", branch_id: "b1", name: "VET" }, { id: "w2", branch_id: "b2", name: "OTHER" }],
      journal_entries: options.journals ?? [] } });
  const rpc = base.client.rpc.bind(base.client);
  (base.client as unknown as { rpc: (name: string, args: unknown) => unknown }).rpc = (name, args) =>
    name === "read_opname_price_report" ? Promise.resolve({ data: "snapshot" in options ? options.snapshot : snapshot, error: null }) : rpc(name as never, args as never);
  state.client = base.client;
  return base;
}

describe("I05 posted price report", () => {
  const journal = (id: string, lines: { debit: number; credit: number; code: string }[]) => ({
    id, no_jurnal: `JRN-${id}`, tanggal: "2026-10-25", branch_id: "b1", source: "opname", source_ref: "OPR-I05", voided_at: null,
    journal_lines: lines.map(line => ({ debit: line.debit, credit: line.credit, coa_accounts: { code: line.code, name: line.code } })),
  });

  it("reconciles original gain and shortage against source journal 1301, independent of report filter", async () => {
    const journals = [
      journal("gain", [{ debit: 100, credit: 0, code: "1301" }, { debit: 0, credit: 100, code: "5902" }]),
      journal("loss", [{ debit: 200, credit: 0, code: "5902" }, { debit: 0, credit: 200, code: "1301" }]),
    ];
    const { client, records } = fixture({ journals });
    const report = await loadOpnamePriceReport(client, { ...period, arah: "lebih", dasar: "jual" });
    expect(report.shown).toHaveLength(1);
    expect(report.journalReview).toMatchObject({ status: "cocok", expectedGain: "100", expectedLoss: "200", ledgerGain: "100", ledgerLoss: "200" });
    expect(report.journalReview?.journals.map(row => row.id)).toEqual(["gain", "loss"]);
    expect(records).toContainEqual(expect.objectContaining({ table: "journal_entries", method: "eq", args: ["source_ref", "OPR-I05"] }));
  });

  it("marks absent, wrong-branch, unbalanced and incomplete source journals for review", async () => {
    expect((await loadOpnamePriceReport(fixture().client, period)).journalReview?.status).toBe("perlu-periksa");
    const wrongBranch = journal("wrong", [{ debit: 100, credit: 0, code: "1301" }, { debit: 0, credit: 100, code: "5902" }]);
    wrongBranch.branch_id = "b2";
    expect((await loadOpnamePriceReport(fixture({ journals: [wrongBranch] }).client, period)).journalReview?.status).toBe("perlu-periksa");
    const unbalanced = journal("broken", [{ debit: 100, credit: 0, code: "1301" }]);
    expect((await loadOpnamePriceReport(fixture({ journals: [unbalanced] }).client, period)).journalReview?.status).toBe("perlu-periksa");
    await expect(loadOpnamePriceReport(fixture({ errorTable: "journal_entries" }).client, period)).rejects.toThrow("Data laporan gagal dibaca");
  });

  it("preserves the selected original snapshot, mode and plus/minus totals", async () => {
    const { client } = fixture();
    const modal = await loadOpnamePriceReport(client, period);
    expect(modal.selected?.resultNo).toBe("OPR-I05");
    expect(modal.scope).toBe("Sebagian");
    expect(modal.rows[0]).toMatchObject({ unitCost: "100", modalDifference: "-200", branchPrice: "0", stockValueAfter: "1300" });
    expect(modal).toMatchObject({ plus: "100", minus: "-200", net: "-100", unavailable: 0 });
    const sale = await loadOpnamePriceReport(client, { ...period, dasar: "jual", arah: "lebih" });
    expect(sale.shown.map(row => row.code)).toEqual(["I05-B"]);
    expect(sale).toMatchObject({ plus: "140", minus: "0", net: "140" });
  });

  it("accepts exact decimal stock differences without binary float drift", async () => {
    const decimalRow = { ...snapshot.rows[0], qty_sistem: 0.3, qty_fisik: 0.2, selisih: -0.1,
      modal_satuan: "100", nilai_selisih_modal: "-10", nilai_selisih_jual: "0" };
    const report = await loadOpnamePriceReport(fixture({ snapshot: { ...snapshot, rows: [decimalRow] } }).client, period);
    expect(report.rows[0]).toMatchObject({ systemQty: 0.3, physicalQty: 0.2, difference: -0.1, modalDifference: "-10" });
  });

  it("denies inactive/non-finance roles and branch failures before exposing snapshot", async () => {
    for (const role of ["STAFF", "DOCTOR", "ADMIN"]) {
      const { client, records } = fixture({ role });
      await expect(loadOpnamePriceReport(client, period)).rejects.toMatchObject({ status: 403 });
      expect(records.some(row => row.table === "opname_results")).toBe(false);
    }
    await expect(loadOpnamePriceReport(fixture({ role: "FINANCE", active: false }).client, period)).rejects.toMatchObject({ status: 403 });
    await expect(loadOpnamePriceReport(fixture({ deniedBranch: "b1" }).client, { ...period, cabang: "b1" })).rejects.toMatchObject({ status: 403 });
  });

  it("filters unauthorized branches in the source query before counting or exposing results", async () => {
    const { client, records } = fixture({ role: "FINANCE", deniedBranch: "b2", otherBranch: true });
    const report = await loadOpnamePriceReport(client, period);
    expect(report.entries.map(row => row.resultNo)).toEqual(["OPR-I05"]);
    expect(report.branches.map(row => row.id)).toEqual(["b1"]);
    expect(records).toContainEqual(expect.objectContaining({ table: "opname_results", method: "in", args: ["opname_orders.warehouse_id", ["w1"]] }));
    await expect(loadOpnamePriceReport(client, { ...period, cabang: "b2" })).rejects.toMatchObject({ status: 403 });
  });

  it("shows legacy unavailability and fails closed on drift, duplicates and incomplete reads", async () => {
    const legacy = await loadOpnamePriceReport(fixture({ snapshot: null }).client, period);
    expect(legacy).toMatchObject({ legacy: true, rows: [], selected: expect.any(Object) });
    await expect(loadOpnamePriceReport(fixture({ snapshot: { ...snapshot, branch_id: "b2" } }).client, period)).rejects.toThrow("tidak sesuai");
    await expect(loadOpnamePriceReport(fixture({ resultCount: 2 }).client, period)).rejects.toThrow("ganda");
    await expect(loadOpnamePriceReport(fixture({ errorTable: "opname_results" }).client, period)).rejects.toThrow();
    expect(() => opnameFilters({ dari: "2026-02-30", sampai: "2026-10-31" })).toThrow();
    expect(opnameSummary([{ ...legacy.rows[0], modalDifference: "0.1", saleDifference: "0.1" }, { ...legacy.rows[0], modalDifference: "0.2", saleDifference: "0.2" }], "modal").net).toBe("0.3");
  });

  it("exports the same filtered rows as CSV and native Excel without executing item names", async () => {
    fixture();
    const query = `dari=2026-10-01&sampai=2026-10-31&order=${ORDER}&dasar=modal&arah=kurang`;
    const csv = await GET(new Request(`https://example.test/laporan/hasil-opname/unduh?${query}&format=csv`));
    expect(csv.status).toBe(200);
    expect(csv.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await csv.text();
    expect(body).toContain("'\u003dSUM(1,1)");
    expect(body).toContain("I05-A"); expect(body).not.toContain("I05-B");
    expect(body).toContain("Ringkasan dan filter");
    const excel = await GET(new Request(`https://example.test/laporan/hasil-opname/unduh?${query}&format=xlsx`));
    expect(excel.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await excel.arrayBuffer()) as never);
    expect(workbook.getWorksheet("Hasil opname")?.rowCount).toBe(2);
    expect(workbook.getWorksheet("Hasil opname")?.getCell("H2").value).toBe("=SUM(1,1)");
    expect(workbook.getWorksheet("Ringkasan dan filter")?.getCell("B7").value).toBe("Modal FIFO saat posting");
  });

  it("does not export made-up legacy costs", async () => {
    fixture({ snapshot: null });
    const response = await GET(new Request(`https://example.test/laporan/hasil-opname/unduh?dari=2026-10-01&sampai=2026-10-31&order=${ORDER}&format=csv`));
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
