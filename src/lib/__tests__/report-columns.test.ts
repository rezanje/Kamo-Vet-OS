// @vitest-environment jsdom
import { expect, it } from "vitest";
import { applyReportColumns, inspectReportTables, normalizeReportColumns } from "../report-columns";
import { displayTable } from "../report-display-export";

function report(markup = '<thead><tr><th>Barang</th><th>Qty</th><th>Total</th></tr></thead><tbody><tr><td>Obat</td><td>2</td><td>300</td></tr><tr><td colspan="3">Kosong</td></tr></tbody><tfoot><tr><td colspan="2">TOTAL</td><td>300</td></tr></tfoot>') {
  const root = document.createElement("div");
  root.innerHTML = `<table>${markup}</table>`;
  return root;
}

it("canonicalizes bounded hidden indices without retaining empty choices", () => {
  expect(normalizeReportColumns('{"tbbbbbbbb-2":[4,0,4],"taaaaaaaa-1":[],"t00000000-1":[2,1]}')).toBe('{"t00000000-1":[1,2],"tbbbbbbbb-2":[0,4]}');
  expect(normalizeReportColumns(null)).toBe("");
  expect(normalizeReportColumns("")).toBe("");
  expect(normalizeReportColumns("{}")).toBe("");
});

it.each(['broken', '[]', 'null', '{"__proto__":[1]}', '{"t12345678-0":[1]}', '{"t12345678-21":[1]}', '{"t12345678-1":"1"}', '{"t12345678-1":[-1]}', '{"t12345678-1":[100]}', '{"t12345678-1":[1.5]}', '{"t12345678-1":[true]}'])('rejects malformed selection %s', raw => {
  expect(() => normalizeReportColumns(raw)).toThrow();
});

it("bounds query size, number of tables and number of submitted indices", () => {
  expect(() => normalizeReportColumns(" ".repeat(3001))).toThrow();
  expect(() => normalizeReportColumns(JSON.stringify(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`t${i.toString(16).padStart(8, "0")}-1`, [1]]))))).toThrow();
  expect(() => normalizeReportColumns(JSON.stringify({ "t12345678-1": Array(101).fill(1) }))).toThrow();
});

it("finds stable header fingerprints and disambiguates identical tables", () => {
  const root = report();
  root.append(root.firstElementChild!.cloneNode(true));
  const tables = inspectReportTables(root).tables;
  expect(tables).toHaveLength(2);
  expect(tables[0].labels).toEqual(["Barang", "Qty", "Total"]);
  expect(tables[0].key).toMatch(/^t[0-9a-f]{8}-1$/);
  expect(tables[1].key).toBe(tables[0].key.replace(/-1$/, "-2"));
  root.querySelector("td")!.textContent = "Data lain";
  expect(inspectReportTables(root).tables[0].key).toBe(tables[0].key);
  root.querySelector("th")!.textContent = "Nama baru";
  expect(inspectReportTables(root).tables[0].key).not.toBe(tables[0].key);
});

it("hides selected cells and shrinks totals and empty rows without changing values", () => {
  const root = report(), table = root.querySelector("table")!;
  const tables = inspectReportTables(root).tables;
  const restore = applyReportColumns(tables, { [tables[0].key]: [1] });
  expect(table.rows[0].cells[1].style.display).toBe("none");
  expect(table.rows[2].cells[0].colSpan).toBe(2);
  expect(table.rows[3].cells[0].colSpan).toBe(1);
  expect(displayTable(table)).toEqual([["Barang", "Total"], ["Obat", "300"], ["Kosong", ""], ["TOTAL", "300"]]);
  restore();
  expect(table.rows[2].cells[0].colSpan).toBe(3);
  expect(table.rows[3].cells[0].colSpan).toBe(2);
  expect(displayTable(table)[1]).toEqual(["Obat", "2", "300"]);
});

it("restores original hidden, inline display, colSpan and marker attributes exactly", () => {
  const root = report(), table = root.querySelector("table")!;
  const cell = table.rows[1].cells[1];
  cell.setAttribute("hidden", "until-found");
  cell.style.setProperty("display", "table-cell", "important");
  const before = table.outerHTML, tables = inspectReportTables(root).tables;
  const restore = applyReportColumns(tables, { [tables[0].key]: [1] });
  restore();
  expect(table.outerHTML).toBe(before);
});

it.each([{hidden:[0,1,2]}, {hidden:[3]}])("fails before changing any table for invalid indices %j", ({hidden}) => {
  const root = report(), tables = inspectReportTables(root).tables, before = root.innerHTML;
  expect(() => applyReportColumns(tables, { [tables[0].key]: hidden })).toThrow();
  expect(root.innerHTML).toBe(before);
});

it("fails before changing tables when a saved fingerprint is no longer present", () => {
  const root = report(), tables = inspectReportTables(root).tables, before = root.innerHTML;
  expect(() => applyReportColumns(tables, { [tables[0].key]: [1], "t00000000-1": [1] })).toThrow();
  expect(root.innerHTML).toBe(before);
});

it.each([
  '<thead><tr><th rowspan="2">A</th><th>B</th></tr><tr><th>C</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody>',
  '<thead><tr><th colspan="2">A</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody>',
  '<thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>A</td></tr></tbody>',
  '<thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>B</td></tr></tbody>',
])("leaves unsupported table shapes visible", markup => {
  const root = report(markup), before = root.innerHTML;
  expect(inspectReportTables(root)).toMatchObject({ tables: [], unsupported: 1 });
  expect(root.innerHTML).toBe(before);
});

it("bounds inspected tables and refuses oversized headers", () => {
  const root = report();
  for (let i = 0; i < 20; i++) root.append(root.firstElementChild!.cloneNode(true));
  expect(inspectReportTables(root)).toMatchObject({ tables: expect.any(Array), unsupported: 1 });
  expect(inspectReportTables(root).tables).toHaveLength(20);
  const oversized = report(`<thead><tr>${'<th>A</th>'.repeat(101)}</tr></thead>`);
  expect(inspectReportTables(oversized).tables).toHaveLength(0);
});
