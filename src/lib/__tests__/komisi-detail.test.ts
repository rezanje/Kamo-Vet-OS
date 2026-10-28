import { expect, it } from "vitest";
import { rincianKomisiText } from "../komisi-detail";

const row = { aturanId: "sku", nama: "Tindakan", dasar: 0.5, komisi: 2_500, cair: true };

it("labels fractional SKU/action quantity and its configured amount per unit", () => {
  expect(rincianKomisiText(row, { tipe: "nominal", basis: "omzet", nominal: 5_000, persen: 0 }))
    .toEqual({ basis: "0,5 unit", tarif: "Rp 5.000/unit" });
});

it("labels net turnover or profit and its configured percentage", () => {
  const money = { ...row, dasar: 75_000 };
  expect(rincianKomisiText(money, { tipe: "persen", basis: "omzet", nominal: 0, persen: 7.5 }))
    .toEqual({ basis: "omzet neto Rp 75.000", tarif: "7,5%" });
  expect(rincianKomisiText(money, { tipe: "persen", basis: "laba", nominal: 0, persen: 7.5 }))
    .toEqual({ basis: "laba Rp 75.000", tarif: "7,5%" });
});

it("does not invent a rate for a posted pool without a rule", () => {
  expect(rincianKomisiText({ ...row, dasar: 50_000 }, undefined))
    .toEqual({ basis: "basis tersimpan Rp 50.000", tarif: null });
});
