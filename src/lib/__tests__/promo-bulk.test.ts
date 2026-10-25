import { expect, it } from "vitest";
import ExcelJS from "exceljs";
import { makePromoExcelTemplate, readPromoExcel } from "../promo-excel";
import { validatePromoRows } from "../promo-bulk";

it("reads its downloadable Excel format and retains different discounts by SKU and unit", async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await makePromoExcelTemplate()) as never);
  const sheet = book.getWorksheet("Promo")!;
  sheet.addRow(["A-01", "PCS", "Persen", 10]);
  sheet.addRow(["A-01", "DUS", "Nominal", 5000]);
  const rows = await readPromoExcel(new Uint8Array(await book.xlsx.writeBuffer()));
  const reviewed = validatePromoRows(rows,
    [{ id: "item-a", code: "A-01", name: "Item A", unit: "PCS", is_active: true }],
    [{ item_id: "item-a", unit: "DUS" }]);
  expect(reviewed.reviewed.every(row => row.error === null)).toBe(true);
  expect(reviewed.valid.map(row => [row.unit, row.discount_type, row.discount_value]))
    .toEqual([["PCS", "percent", 10], ["DUS", "nominal", 5000]]);
});

it("marks unknown SKU, unregistered unit, duplicate target, and bad discount before save", () => {
  const rows = [
    { line: 2, code: "A-01", unit: "PCS", discount_type: "Persen", discount_value: "10" },
    { line: 3, code: "A-01", unit: "PCS", discount_type: "Persen", discount_value: "20" },
    { line: 4, code: "A-01", unit: "DUS", discount_type: "Nominal", discount_value: "50" },
    { line: 5, code: "MISSING", unit: "PCS", discount_type: "Persen", discount_value: "10" },
    { line: 6, code: "A-01", unit: "PCS2", discount_type: "Persen", discount_value: "10" },
    { line: 7, code: "A-01", unit: "BOX", discount_type: "Persen", discount_value: "101" },
  ];
  const result = validatePromoRows(rows,
    [{ id: "a", code: "A-01", name: "A", unit: "PCS", is_active: true }],
    [{ item_id: "a", unit: "BOX" }]);
  expect(result.valid).toHaveLength(1);
  expect(result.reviewed.slice(1).every(row => row.error)).toBe(true);
});

it("rejects formulas instead of trusting uncalculated Excel values", async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await makePromoExcelTemplate()) as never);
  book.getWorksheet("Promo")!.addRow(["A-01", "PCS", "Persen", { formula: "1+1" }]);
  await expect(readPromoExcel(new Uint8Array(await book.xlsx.writeBuffer()))).rejects.toThrow("Rumus tidak didukung");
});

it("reads a sparse worksheet without scanning empty row numbers", async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await makePromoExcelTemplate()) as never);
  book.getWorksheet("Promo")!.getRow(50_000).values = ["A-01", "PCS", "Persen", 10];
  const rows = await readPromoExcel(new Uint8Array(await book.xlsx.writeBuffer()));
  expect(rows).toEqual([{ line: 50_000, code: "A-01", unit: "PCS", discount_type: "Persen", discount_value: "10" }]);
});
