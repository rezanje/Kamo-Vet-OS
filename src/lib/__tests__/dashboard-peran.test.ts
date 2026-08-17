import { describe, expect, it } from "vitest";
import { bacaSudut, sudutBawaan } from "../dashboard-peran";

describe("sudutBawaan", () => {
  it("keuangan untuk FINANCE & owner/admin", () => {
    expect(sudutBawaan("FINANCE")).toBe("keuangan");
    expect(sudutBawaan("OWNER")).toBe("keuangan");
    expect(sudutBawaan("ADMIN")).toBe("keuangan");
  });
  it("operasional untuk staf toko & dokter", () => {
    expect(sudutBawaan("STAFF")).toBe("operasional");
    expect(sudutBawaan("DOCTOR")).toBe("operasional");
    expect(sudutBawaan("doctor")).toBe("operasional");
  });
  it("peran tidak dikenal tetap dapat tampilan", () => {
    expect(sudutBawaan(null)).toBe("keuangan");
  });
});

describe("bacaSudut", () => {
  it("pilihan dari URL menang", () => {
    expect(bacaSudut("marketing", "FINANCE")).toBe("marketing");
    expect(bacaSudut("operasional", "OWNER")).toBe("operasional");
  });
  it("nilai ngawur jatuh ke bawaan peran", () => {
    expect(bacaSudut("sembarang", "STAFF")).toBe("operasional");
    expect(bacaSudut(undefined, "FINANCE")).toBe("keuangan");
  });
});
