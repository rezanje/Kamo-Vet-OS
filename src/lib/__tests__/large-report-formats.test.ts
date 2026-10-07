import { expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { clientFixture } from "./fixtures/hpp-report-client";
const mock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mock.createClient }));
import { GET as itemDownload } from "../../app/(app)/laporan/penjualan-barang/unduh/route";
import { downloadHppReport } from "../hpp-reports-download";

const count = 5201;
const id = (index: number) => String(index).padStart(5, "0");
const saleItems = Array.from({ length: count }, (_, index) => ({ id: id(index), nama: `Obat ${id(index)}`, qty: 1, harga: 100, item_discount_type: null, item_discount_value: 0, promo_discount: 0,
  sales: { id: `sale-${id(index)}`, no_struk: `STRUK-${id(index)}`, created_at: "2026-10-04T05:00:00Z", channel: null, branches: { name: "Kasir A" }, customers: { name: "Pemilik" } },
}));
const inventory = {
  stock: Array.from({ length: count }, (_, index) => ({ id: `stock-${id(index)}`, warehouse_id: "w1", item_id: `item-${id(index)}`, qty: 1 })),
  stock_layers: Array.from({ length: count }, (_, index) => ({ id: `layer-${id(index)}`, warehouse_id: "w1", item_id: `item-${id(index)}`, qty_left: 1, unit_cost: index === count - 1 ? null : 50 })),
  items: Array.from({ length: count }, (_, index) => ({ id: `item-${id(index)}`, code: `SKU-${id(index)}`, name: `Obat ${id(index)}`, unit: "ml", is_active: true })),
};

it.each(["csv", "xlsx", "print"])("exports a complete item-sales cohort beyond 5000 as %s with filtered totals", async format => {
  mock.createClient.mockResolvedValue(clientFixture({ tables: { sale_items: saleItems } }).client);
  const response = await itemDownload(new Request(`https://example.test/unduh?dari=2026-10-01&sampai=2026-10-04&kanal=POS&jenis=Barang&q=Obat&halaman=2&format=${format}`));
  expect(response.status).toBe(200);
  if (format === "xlsx") {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.getWorksheet("Penjualan barang")!;
    expect(sheet.rowCount).toBe(count + 1);
    expect(sheet.getRow(count + 1).getCell(2).value).toBe("STRUK-05200");
    expect(book.getWorksheet("Ringkasan dan filter")!.getRow(9).getCell(2).value).toBe(count * 100);
  } else {
    const output = await response.text();
    expect(output).toContain("STRUK-00000");
    expect(output).toContain("STRUK-05200");
    expect(output).toContain(String(count * 100));
    expect(output).toContain("2026-10-01");
  }
}, 15000);

it.each(["csv", "xlsx", "print"])("exports the complete FIFO cohort beyond 5000 as %s without filling unknown costs", async format => {
  const { client } = clientFixture({ tables: inventory });
  const response = await downloadHppReport(client, "inventory", new Request(`https://example.test/unduh?cabang=b1&q=Obat&halaman=2&format=${format}`));
  expect(response.status).toBe(200);
  if (format === "xlsx") {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.getWorksheet("Persediaan")!;
    expect(sheet.rowCount).toBe(count + 1);
    expect(sheet.getRow(count + 1).getCell(3).value).toBe("SKU-05200");
    expect(sheet.getRow(count + 1).getCell(11).value).toBeNull();
    expect(sheet.getRow(count + 1).getCell(12).value).toBeNull();
  } else {
    const output = await response.text();
    expect(output).toContain("SKU-00000");
    expect(output).toContain("SKU-05200");
    expect(output).toContain("Belum lengkap");
    expect(output).toContain(String((count - 1) * 50));
  }
}, 15000);
