// @vitest-environment jsdom
import { expect, it } from "vitest";
import { displayTable, displaySections, displayFilters } from "../report-display-export";
import { reportCsv } from "../csv-report";

it("keeps totals aligned after merged cells and includes all displayed rows", () => {
  const table = document.createElement("table");
  table.innerHTML = '<thead><tr><th rowspan="2">Akun</th><th colspan="2">Saldo</th></tr><tr><th>Debit</th><th>Kredit</th></tr></thead><tbody><tr><td>=1+1</td><td>10</td><td>20</td></tr></tbody><tfoot><tr><td colspan="2">TOTAL</td><td>30</td></tr></tfoot>';
  expect(displayTable(table)).toEqual([["Akun", "Saldo", ""], ["", "Debit", "Kredit"], ["=1+1", "10", "20"], ["TOTAL", "", "30"]]);
  expect(reportCsv([], displayTable(table))).toContain('"\'=1+1"');
});

it("includes non-table summaries, section text and incompleteness warnings", () => {
  const root = document.createElement("div");
  root.innerHTML = '<div data-report-row><span>Laba bersih</span><span>Rp 500</span></div><p>Data belum lengkap</p><table><tr><th>Barang</th></tr><tr><td>Obat</td></tr></table>';
  expect(displaySections(root)).toEqual([{ name: "Ringkasan", rows: [["Laba bersih", "Rp 500"]] }, { name: "Tabel 1", rows: [["Barang"], ["Obat"]] }, { name: "Keterangan", rows: [["Data belum lengkap"]] }]);
});

it("exports the applied defaults even after a filter is edited without submitting", () => {
  const root = document.createElement("div");
  root.innerHTML = '<form><div><label>Dari</label><input name="dari" value="2026-10-01"></div><div><label>Cabang</label><select name="cabang"><option>Semua</option><option selected>Klinik A</option></select></div></form>';
  root.querySelector("input")!.value = "2026-10-07";
  root.querySelector("select")!.selectedIndex = 0;
  expect(displayFilters(root)).toEqual([["Dari", "2026-10-01"], ["Cabang", "Klinik A"]]);
});

it("exports unrelated hidden cells and omits only explicitly selected-out report columns", () => {
  const table = document.createElement("table");
  table.innerHTML = '<tr><th>Nama</th><th>Qty</th><th data-report-column-hidden="true" hidden style="display:none">Rahasia</th></tr><tr><td hidden>Obat</td><td style="display:none">2</td><td data-report-column-hidden="true" hidden>internal</td></tr>';
  expect(displayTable(table)).toEqual([["Nama", "Qty"], ["Obat", "2"]]);
});

it("keeps the serialized column setting out of human-readable exported filters", () => {
  const root = document.createElement("div");
  root.innerHTML = '<form><input name="bulan" value="2026-10"><input type="hidden" name="kolom" data-report-columns-input value="{&quot;t12345678-1&quot;:[1]}"></form>';
  expect(displayFilters(root)).toEqual([["bulan", "2026-10"]]);
});
