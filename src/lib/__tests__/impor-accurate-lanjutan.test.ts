import { describe, expect, it } from "vitest";
import {
  gabungWorkbookAccurate,
  groupComponentPayload,
  parseKomponenGrupRows,
  parseSaldoAwalRows,
  fingerprintInput,
} from "../impor-accurate-lanjutan";

describe("gabungWorkbookAccurate", () => {
  it("menolak kode kembar lintas-file", () => {
    const hasil = gabungWorkbookAccurate([
      { file: "1.xlsx", rows: [{ row_no: 2, code: "SKU-1", name: "A" }] },
      { file: "2.xlsx", rows: [{ row_no: 7, code: "sku-1", name: "B" }] },
    ]);
    expect(hasil.rows).toEqual([]);
    expect(hasil.rejected.map((r) => r.source)).toEqual(["1.xlsx:2", "2.xlsx:7"]);
  });
});

describe("parseSaldoAwalRows", () => {
  it("mewajibkan HPP dan data expiry untuk barang expiry", () => {
    expect(parseSaldoAwalRows([
      { row: 2, code: "EXP", warehouse: "GDG-1", qty: 2, unit: "PCS", unitCost: null, asOf: "2026-08-31", expDate: null },
    ], new Map([["EXP", { itemType: "Persediaan", unit: "PCS", trackExpiry: true }]]))).toMatchObject({ valid: [], rejected: [{ row: 2 }] });
  });
});

describe("parseKomponenGrupRows", () => {
  it("menolak Grup bertingkat", () => {
    const hasil = parseKomponenGrupRows([
      { row: 2, groupCode: "G1", componentCode: "G2", qty: 1, unit: "PCS", sortOrder: 1 },
    ], new Map([
      ["G1", { itemType: "Grup", unit: "PCS" }],
      ["G2", { itemType: "Grup", unit: "PCS" }],
    ]));
    expect(hasil.rejected[0].reason).toMatch(/Grup bertingkat/);
  });
});

describe("helpers Accurate lanjutan", () => {
  it("mengurutkan file sebelum membuat fingerprint", () => {
    expect(fingerprintInput([{ name: "b.xlsx", size: 2 }, { name: "a.xlsx", size: 1 }]))
      .toBe("a.xlsx:1|b.xlsx:2");
  });

  it("menyusun payload komponen per kode Grup", () => {
    expect(groupComponentPayload([
      { groupCode: "G1", componentId: "i1", qty: 2, unit: "PCS", factor: 1, sortOrder: 2 },
      { groupCode: "G1", componentId: "i2", qty: 1, unit: "PCS", factor: 1, sortOrder: 1 },
    ])).toEqual(new Map([["G1", [
      { component_item_id: "i2", qty: 1, unit: "PCS", sort_order: 1 },
      { component_item_id: "i1", qty: 2, unit: "PCS", sort_order: 2 },
    ]]]));
  });
});
