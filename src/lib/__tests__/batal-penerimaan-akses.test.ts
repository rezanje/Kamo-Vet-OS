import { describe, expect, it } from "vitest";
import { adaPenerimaan, bolehBatalPenerimaan } from "../batal-penerimaan-akses";

describe("bolehBatalPenerimaan", () => {
  it("memakai jawaban database apa adanya", async () => {
    expect(await bolehBatalPenerimaan({ rpc: async () => ({ data: true, error: null }) }, "STAFF")).toBe(true);
    expect(await bolehBatalPenerimaan({ rpc: async () => ({ data: false, error: null }) }, "OWNER")).toBe(false);
    expect(await bolehBatalPenerimaan({ rpc: async () => ({ data: null, error: null }) }, "ADMIN")).toBe(false);
  });
  it("Owner tidak pernah terkunci oleh galat baca (database tetap memutuskan); peran lain gagal-tertutup", async () => {
    const galat = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    const lempar = { rpc: async () => { throw new Error("jaringan"); } };
    expect(await bolehBatalPenerimaan(galat, "OWNER")).toBe(true);
    expect(await bolehBatalPenerimaan(lempar, "OWNER")).toBe(true);
    expect(await bolehBatalPenerimaan(galat, "ADMIN")).toBe(false);
    expect(await bolehBatalPenerimaan(lempar, "FINANCE")).toBe(false);
    expect(await bolehBatalPenerimaan({}, undefined)).toBe(false);
  });
});

describe("adaPenerimaan", () => {
  it("hanya tagihan yang punya uang diterima yang punya sesuatu untuk dibatalkan", () => {
    expect(adaPenerimaan({ paid_status: "Lunas" }, 0)).toBe(true);
    expect(adaPenerimaan({ paid_status: "DP", dp_amount: 1000 }, 0)).toBe(true);
    expect(adaPenerimaan({ paid_status: "Belum Lunas", dp_amount: 0 }, 0)).toBe(false);
    expect(adaPenerimaan({ paid_status: "Belum Lunas", dp_amount: "0" }, 5000)).toBe(true);
  });
});
