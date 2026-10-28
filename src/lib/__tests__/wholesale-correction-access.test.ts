import { expect, it } from "vitest";
import { bisaKoreksiGrosir } from "@/lib/wholesale-correction-access";

it("allows only active OWNER and FINANCE to see the wholesale correction form", () => {
  expect(bisaKoreksiGrosir({ role: "OWNER", is_active: true })).toBe(true);
  expect(bisaKoreksiGrosir({ role: "FINANCE", is_active: true })).toBe(true);
  for (const role of ["ADMIN", "STAFF", "DOCTOR", "CASHIER", null]) expect(bisaKoreksiGrosir({ role, is_active: true })).toBe(false);
  expect(bisaKoreksiGrosir({ role: "FINANCE", is_active: false })).toBe(false);
  expect(bisaKoreksiGrosir(null)).toBe(false);
});
