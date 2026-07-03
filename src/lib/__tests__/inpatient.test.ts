import { describe, expect, it } from "vitest";
import { canTransition, isTerminal, ripWaMessage, type Role } from "../inpatient";

describe("canTransition", () => {
  it("rip only allowed for DOCTOR", () => {
    const others: Role[] = ["OWNER", "ADMIN", "FINANCE", "STAFF"];
    for (const r of others) expect(canTransition(r, "rip")).toBe(false);
    expect(canTransition("DOCTOR", "rip")).toBe(true);
  });
  it("non-rip transitions allowed for any role", () => {
    expect(canTransition("STAFF", "kritis")).toBe(true);
    expect(canTransition("STAFF", "sembuh")).toBe(true);
    expect(canTransition("ADMIN", "stabil")).toBe(true);
  });
});

describe("isTerminal", () => {
  it("sembuh & rip are terminal, stabil & kritis are not", () => {
    expect(isTerminal("sembuh")).toBe(true);
    expect(isTerminal("rip")).toBe(true);
    expect(isTerminal("stabil")).toBe(false);
    expect(isTerminal("kritis")).toBe(false);
  });
});

describe("ripWaMessage", () => {
  it("mentions pet, owner, and branch", () => {
    const msg = ripWaMessage("Choco", "Susi", "Kamo Klinik Cimanggu");
    expect(msg).toContain("Choco");
    expect(msg).toContain("Susi");
    expect(msg).toContain("Kamo Klinik Cimanggu");
    expect(msg).toContain("berduka");
  });
});
