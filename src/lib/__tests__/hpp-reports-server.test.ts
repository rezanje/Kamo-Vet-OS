import { describe, expect, it } from "vitest";
import { loadInventoryReport, loadCompoundReport, readReportRows, reportScope } from "../hpp-reports-server";

import { clientFixture, type Row } from "./fixtures/hpp-report-client";

describe("financial report boundary", () => {
  it.each(["DOCTOR","STAFF","ADMIN",""])("denies %s before reading financial rows", async role => {
    const { client, records } = clientFixture({ role });
    await expect(loadInventoryReport(client, {})).rejects.toMatchObject({ status: 403 });
    expect(records.some(r => ["stock","stock_layers","invoice_items"].includes(r.table))).toBe(false);
  });
  it("denies anonymous and finance without the laporan module", async () => {
    await expect(reportScope(clientFixture({ anonymous: true }).client, "/laporan/nilai-persediaan", "")).rejects.toMatchObject({ status: 401 });
    await expect(loadCompoundReport(clientFixture({ role: "FINANCE", modules: [{ role: "FINANCE", module_id: "klinik" }] }).client, {})).rejects.toMatchObject({ status: 403 });
  });
  it("fails closed on profile/module errors and branch RPC rejection", async () => {
    for (const errorTable of ["profiles","role_modules"]) await expect(loadInventoryReport(clientFixture({ errorTable }).client, {})).rejects.toThrow();
    await expect(loadInventoryReport(clientFixture({ deniedBranch: "b1" }).client, { cabang: "b1" })).rejects.toMatchObject({ status: 403 });
    await expect(loadInventoryReport(clientFixture().client, { cabang: "foreign" })).rejects.toMatchObject({ status: 403 });
  });
  it("retains inactive holdings and scopes layer reads to authorized warehouses", async () => {
    const { client, records } = clientFixture({ role: "FINANCE" });
    const report = await loadInventoryReport(client, { cabang: "b1" });
    expect(report.rows[0]).toMatchObject({ value: 150, name: "Obat lama", warehouse: "VET lama", itemActive: false, warehouseActive: false });
    expect(records.some(r => r.table === "stock_layers" && r.method === "in" && r.args[0] === "warehouse_id" && (r.args[1] as string[]).includes("w1"))).toBe(true);
    expect(records.some(r => ["stock","stock_layers"].includes(r.table) && ["gte","lte"].includes(r.method))).toBe(false);
  });
  it("never returns partial totals after financial or enrichment read failures", async () => {
    for (const errorTable of ["stock","stock_layers","items"]) await expect(loadInventoryReport(clientFixture({ errorTable }).client, {})).rejects.toThrow("Data laporan gagal dibaca");
  });
});

describe("complete report reads", () => {
  it("reads beyond one page and fails rather than truncate above the cap", async () => {
    const source = Array.from({ length: 1201 }, (_, id) => ({ id }));
    expect(await readReportRows(async (from,to) => ({ data: source.slice(from,to+1), error: null }))).toHaveLength(1201);
    await expect(readReportRows(async () => ({ data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null }))).rejects.toThrow("terlalu banyak");
    await expect(readReportRows(async from => ({ data: from ? null : source.slice(0,500), error: from ? { message: "later page" } : null }))).rejects.toThrow("later page");
    await expect(readReportRows(async () => ({ data: null, error: null }))).rejects.toThrow("Data laporan gagal dibaca");
  });
  const invoice = (id: string, recipe: string|null, time="2026-10-04T12:00:00+07:00", voided_at: string|null=null): Row => ({ id, compound_recipe_id: recipe, qty: 2, harga: 100, diskon_persen: 10, hpp: 50, deskripsi: "Nama sama",
    invoices: { id: "inv", visit_id: "visit", invoice_no: "INV", created_at: time, paid_status: "Belum Lunas", voided_at, visits: { branch_id: "b1", dokter: "Dr Satu", doctor_id: "d1" } } });
  it("uses exact recipe links, WIB invoice period, assigned doctor and optional hidden version metadata", async () => {
    const { client, records } = clientFixture({ role: "FINANCE", tables: {
      invoice_items: [invoice("first","r1"), invoice("second","r2"), invoice("legacy",null), invoice("void","r3",undefined,"2026-10-05"), invoice("outside","r4","2026-09-30T12:00:00+07:00")],
      compounding_recipes: [{ id: "r1", recipe_name: "Lama", status: "handed_over" },{ id: "r2", recipe_name: "Baru", status: "pending" }],
      compound_official_usage: [{ recipe_id: "r1", formula_version_id: "inactive-v1" }],
      compound_formula_versions: [],
    } });
    const report = await loadCompoundReport(client, { dari: "2026-10-01", sampai: "2026-10-04", cabang: "b1", dokter: "d1" });
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]).toMatchObject({ formulaVersionId: "inactive-v1", doctor: "Dr Satu", cost: 50, revenue: 180 });
    expect(report.summary.cost).toBe(100);
    expect(records.find(r => r.table === "invoice_items" && r.method === "gte")?.args).toEqual(["invoices.created_at","2026-10-01T00:00:00+07:00"]);
    expect(records.find(r => r.table === "invoice_items" && r.method === "lte")?.args).toEqual(["invoices.created_at","2026-10-04T23:59:59.999+07:00"]);
    expect(records.some(r => r.table === "compound_issues")).toBe(false);
  });
  it("rejects invalid calendar/reversed ranges and filters rows before totals", async () => {
    await expect(loadCompoundReport(clientFixture().client, { dari: "2026-02-30", sampai: "2026-10-04" })).rejects.toThrow("Rentang tanggal");
    await expect(loadCompoundReport(clientFixture().client, { dari: "2026-10-05", sampai: "2026-10-04" })).rejects.toThrow("Rentang tanggal");
    const { client } = clientFixture({ tables: { invoice_items: [invoice("first","r1")], compounding_recipes: [{ id: "r1", recipe_name: "Lama" }] } });
    const report = await loadCompoundReport(client, { dari: "2026-10-01", sampai: "2026-10-04", q: "missing" });
    expect(report.rows).toEqual([]); expect(report.summary.revenue).toBe(0);
  });
});
