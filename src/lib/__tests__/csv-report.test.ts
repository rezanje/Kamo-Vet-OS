import { describe, expect, it } from "vitest";
import { reportCsv } from "../csv-report";

describe("reportCsv", () => {
  it("keeps numeric values usable while escaping quotes, multiline text, and spreadsheet formulas", () => {
    expect(reportCsv(["Nama", "Qty", "Harga"], [["=HYPERLINK(\"bad\",\"click\")", 2, -100], ["  +SUM(1,1)\nnext", 1.5, 0]])).toBe(
      '\uFEFF"Nama","Qty","Harga"\r\n"\'=HYPERLINK(""bad"",""click"")","2","-100"\r\n"\'  +SUM(1,1)\nnext","1.5","0"\r\n',
    );
  });
});
