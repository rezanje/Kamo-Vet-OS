import { expect, it } from "vitest";
import ExcelJS from "exceljs";
import { makePromoExcelTemplate, readPromoExcel } from "../promo-excel";
import { validatePromoRows } from "../promo-bulk";

async function templateBook() {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await makePromoExcelTemplate()) as never);
  return book;
}
const save = async (book: ExcelJS.Workbook) => new Uint8Array(await book.xlsx.writeBuffer());
const guideText = (book: ExcelJS.Workbook) => {
  const lines: string[] = [];
  book.getWorksheet("Petunjuk")!.eachRow(row => lines.push(`${row.getCell(1).value}: ${row.getCell(2).value}`));
  return lines.join("\n");
};

it("keeps the four headers and an empty data sheet (no example SKU rows)", async () => {
  const book = await templateBook();
  const sheet = book.getWorksheet("Promo")!;
  expect(sheet.getRow(1).values).toEqual([undefined, "Kode Barang", "Satuan", "Jenis Diskon", "Nilai Diskon"]);
  expect(sheet.actualRowCount).toBe(1);
  await expect(readPromoExcel(await save(book))).rejects.toThrow("belum berisi baris barang");
});

it("offers Persen, Nominal and Harga Akhir as the Jenis Diskon dropdown hint without blocking typing", async () => {
  const sheet = (await templateBook()).getWorksheet("Promo")!;
  for (const address of ["C2", "C250", "C501"]) {
    expect(sheet.getCell(address).dataValidation).toMatchObject({
      type: "list", allowBlank: true, formulae: ['"Persen,Nominal,Harga Akhir"'], errorStyle: "warning", showErrorMessage: true,
    });
  }
});

it("documents Harga Akhir, exact units and the nominal-storage limitation in the Petunjuk sheet", async () => {
  const text = guideText(await templateBook());
  expect(text).toMatch(/Jenis Diskon: .*Persen.*Nominal.*Harga Akhir/);
  expect(text).toContain("Harga akhir promo per barang dan satuan");
  expect(text).toMatch(/1\/2KG.*400gr.*800GR.*KG/);
  expect(text).toMatch(/400g4.*ditolak/);
  expect(text).toMatch(/tanpa titik.*koma.*Rp|tanpa titik, koma, atau Rp/);
  expect(text).toMatch(/potongan nominal[\s\S]*harga normal[\s\S]*diubah[\s\S]*bergeser/);
  expect(text).toMatch(/lebih rendah dari harga normal/);
  expect(text).toMatch(/selisih.*rupiah bulat/);
  expect(text).toMatch(/golongan pelanggan.*lebih rendah dari Harga Akhir/);
  expect(text).toMatch(/satu promo.*terbesar/);
  expect(text).toMatch(/cabang[\s\S]*harga normal[\s\S]*berbeda/i);
});

it("does not contain real-looking SKUs: only the four header cells in Promo", async () => {
  const sheet = (await templateBook()).getWorksheet("Promo")!;
  const values: unknown[] = [];
  sheet.eachRow(row => row.eachCell(cell => values.push(cell.value)));
  expect(values).toEqual(["Kode Barang", "Satuan", "Jenis Diskon", "Nilai Diskon"]);
});

it("parses mixed Persen, Nominal and Harga Akhir rows, keeping unit text and price text exactly", async () => {
  const book = await templateBook();
  const sheet = book.getWorksheet("Promo")!;
  sheet.addRow(["0012", "1/2KG", "Persen", 10]);
  sheet.addRow(["0012", "KG", "Nominal", 5000]);
  sheet.addRow(["0013", "400gr", "Harga Akhir", 18500]);
  sheet.addRow(["0014", "800GR", "Harga Akhir Promo", "18.500"]);
  sheet.addRow(["0015", "400g4", "Harga Akhir", "Rp 18.500"]);
  const rows = await readPromoExcel(await save(book));
  expect(rows.map(({ code, unit, discount_type, discount_value }) => [code, unit, discount_type, discount_value])).toEqual([
    ["0012", "1/2KG", "Persen", "10"], ["0012", "KG", "Nominal", "5000"], ["0013", "400gr", "Harga Akhir", "18500"],
    ["0014", "800GR", "Harga Akhir Promo", "18.500"], ["0015", "400g4", "Harga Akhir", "Rp 18.500"],
  ]);
  const catalog = [
    { id: "i13", code: "0013", name: "Fiktif 13", unit: "400gr", is_active: true, item_type: "Persediaan", sell_price: 20000, buy_price: 10000 },
    { id: "i14", code: "0014", name: "Fiktif 14", unit: "800GR", is_active: true, item_type: "Persediaan", sell_price: 20000, buy_price: 10000 },
    { id: "i15", code: "0015", name: "Fiktif 15", unit: "400gr", is_active: true, item_type: "Persediaan", sell_price: 20000, buy_price: 10000 },
  ];
  const result = validatePromoRows(rows.slice(2), catalog, [], { scope: [{ id: "b", name: "Cabang" }], branchPrices: [], tierItemIds: [] });
  expect(result.valid).toEqual([{ code: "0013", unit: "400gr", discount_type: "nominal", discount_value: 1500 }]);
  expect(result.reviewed[1].error).toMatch(/angka polos/);
  expect(result.reviewed[2].error).toMatch(/Satuan tidak terdaftar/);
});

it("still rejects formulas in a Harga Akhir value", async () => {
  const book = await templateBook();
  book.getWorksheet("Promo")!.addRow(["A-01", "PCS", "Harga Akhir", { formula: "1000+500" }]);
  await expect(readPromoExcel(await save(book))).rejects.toThrow("Rumus tidak didukung");
});

it("still enforces 500 rows and 1 MB", async () => {
  const book = await templateBook();
  for (let i = 0; i < 501; i++) book.getWorksheet("Promo")!.addRow([`A-${i}`, "PCS", "Harga Akhir", 1000]);
  await expect(readPromoExcel(await save(book))).rejects.toThrow("Maksimal 500 baris");
  await expect(readPromoExcel(new Uint8Array(1_000_001))).rejects.toThrow("1 MB");
});
