import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { downloadHppReport } from "../hpp-reports-download";
import { clientFixture } from "./fixtures/hpp-report-client";

const tables = {
  stock: Array.from({ length: 205 }, (_, i) => ({ id: `s${i}`, warehouse_id: "w1", item_id: `i${i}`, qty: 2 })),
  stock_layers: Array.from({ length: 205 }, (_, i) => ({ id: `l${i}`, warehouse_id: "w1", item_id: `i${i}`, qty_left: 2, unit_cost: 50 })),
  items: Array.from({ length: 205 }, (_, i) => ({ id: `i${i}`, code: `SKU${i}`, name: i === 0 ? "<script>alert(1)</script>" : `Obat ${i}`, unit: "ml", is_active: true })),
};
describe("complete protected HPP formats", () => {
  it("exports every row as numeric Excel cells, independently of visible page", async () => {
    const response = await downloadHppReport(clientFixture({ tables }).client, "inventory", new Request("https://example.test/unduh?format=xlsx&halaman=2"));
    expect(response.headers.get("Content-Type")).toContain("spreadsheetml");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    expect(book.worksheets[0].rowCount).toBe(206);
    expect(book.worksheets[0].getRow(2).getCell(11).value).toBe(100);
    expect(book.worksheets[0].getRows(2,205)?.some(row => row.getCell(3).value === "SKU204")).toBe(true);
  });
  it("prints the complete filtered report with escaped labels and no partial-page disclaimer", async () => {
    const response = await downloadHppReport(clientFixture({ tables }).client, "inventory", new Request("https://example.test/unduh?format=print&halaman=2"));
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("SKU204");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect((html.match(/<tr>/g) ?? []).length).toBeGreaterThanOrEqual(206);
    expect(html).toContain("Subtotal lapisan ber-HPP");
  });
  it.each(["xlsx", "print"])("denies costs via direct %s URLs", async format => {
    const { client, records } = clientFixture({ role: "DOCTOR" });
    const response = await downloadHppReport(client,"inventory",new Request(`https://example.test/unduh?format=${format}`));
    expect(response.status).toBe(403);
    expect(records.some(row => row.table === "stock_layers")).toBe(false);
  });
});

it("keeps ingredient costs unavailable and exports their exact recipe link with complete margin sheet", async () => {
  const client = clientFixture({ tables: {
    invoice_items: [{ id: "line", compound_recipe_id: "recipe", qty: 1, harga: 200, diskon_persen: 0, hpp: 50, deskripsi: "Racikan", invoices: {
      id: "invoice", visit_id: "visit", invoice_no: "INV", created_at: "2026-10-04T05:00:00Z", paid_status: "Lunas", voided_at: null, visits: { branch_id: "b1", dokter: "Dr A", doctor_id: "doctor" },
    } }],
    compounding_ingredients: [{ id: "ingredient", recipe_id: "recipe", item_id: "i", ingredient_name: "Obat", quantity: 3, unit: "ml" }],
  } }).client;
  const response = await downloadHppReport(client, "compound", new Request("https://example.test/unduh?dari=2026-10-04&sampai=2026-10-04&format=xlsx"));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await response.arrayBuffer());
  expect(book.getWorksheet("Margin racikan")?.getRow(2).getCell(11).value).toBe(50);
  const row = book.getWorksheet("Bahan racikan")!.getRow(2);
  expect(row.getCell(6).value).toBe("recipe");
  expect(row.getCell(8).value).toBe("Obat");
  expect(row.getCell(11).value).toBe(3);
  expect(row.getCell(12).value).toBe("Resep tersimpan");
  expect(row.getCell(13).value).toBeNull();
  expect(row.getCell(14).value).toBeNull();
});

it.each(["csv", "xlsx", "print"])("exports legacy reconciliation with source IDs and unavailable financial values as %s", async format => {
  const client = clientFixture({ tables: { invoice_items: [{ id: "old-line", compound_recipe_id: null, satuan: "racikan", deskripsi: "Racikan lama", qty: 2, harga: 100, hpp: null,
    invoices: { id: "old-invoice", visit_id: "old-visit", invoice_no: "INV-OLD", created_at: "2026-10-04T05:00:00Z", paid_status: "Lunas", voided_at: null, visits: { branch_id: "b1", dokter: "Dr A", doctor_id: "doctor" } },
  }] } }).client;
  const response = await downloadHppReport(client, "compound", new Request(`https://example.test/unduh?dari=2026-10-04&sampai=2026-10-04&rincian=rekonsiliasi&format=${format}`));
  expect(response.status).toBe(200);
  if (format === "xlsx") {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const row = book.getWorksheet("Rekonsiliasi")!.getRow(2);
    expect(row.getCell(4).value).toBe("old-line");
    expect([9, 10, 11, 12].map(index => row.getCell(index).value)).toEqual([null, null, null, null]);
    expect(book.getWorksheet("Margin racikan")!.rowCount).toBe(1);
  } else {
    const content = await response.text();
    expect(content).toContain("old-line");
    expect(content).toContain("old-invoice");
    expect(content).toContain("Baris racikan belum memiliki tautan ID resep");
  }
});
