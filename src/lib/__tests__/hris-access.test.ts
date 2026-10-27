import { describe, expect, it } from "vitest";
import { bolehKelolaHris, bolehKelolaPayroll, bolehLihatDataPribadi } from "../hris-access";

describe("hak akses HRIS pilot", () => {
  it("OWNER mengelola seluruh HRIS dan payroll", () => {
    expect(bolehKelolaHris("OWNER")).toBe(true);
    expect(bolehKelolaPayroll("OWNER")).toBe(true);
  });

  it("ADMIN mengelola HRIS cabang tetapi bukan payroll", () => {
    expect(bolehKelolaHris("ADMIN")).toBe(true);
    expect(bolehKelolaPayroll("ADMIN")).toBe(false);
  });

  it("STAFF dan DOCTOR hanya memakai data pribadi", () => {
    expect(bolehKelolaHris("STAFF")).toBe(false);
    expect(bolehLihatDataPribadi("STAFF")).toBe(true);
    expect(bolehLihatDataPribadi("DOCTOR")).toBe(true);
  });

  it("FINANCE tidak mendapat akses HRIS pada pilot", () => {
    expect(bolehKelolaHris("FINANCE")).toBe(false);
    expect(bolehKelolaPayroll("FINANCE")).toBe(false);
  });
});
