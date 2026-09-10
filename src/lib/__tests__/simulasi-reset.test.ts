import { describe, expect, it } from "vitest";
import { RESET_SIMULASI_TOTAL_PHRASE, bolehResetSimulasi } from "../simulasi-reset";

describe("bolehResetSimulasi", () => {
  it("hanya mengaktifkan reset untuk OWNER yang sadar dampaknya dan mengetik frasa tepat", () => {
    expect(bolehResetSimulasi({
      role: "OWNER",
      understoodImpact: true,
      confirmation: RESET_SIMULASI_TOTAL_PHRASE,
    })).toBe(true);
  });

  it("menahan reset bila peran, persetujuan, atau frasa tidak lengkap", () => {
    expect(bolehResetSimulasi({
      role: "ADMIN",
      understoodImpact: true,
      confirmation: RESET_SIMULASI_TOTAL_PHRASE,
    })).toBe(false);
    expect(bolehResetSimulasi({
      role: "OWNER",
      understoodImpact: false,
      confirmation: RESET_SIMULASI_TOTAL_PHRASE,
    })).toBe(false);
    expect(bolehResetSimulasi({
      role: "OWNER",
      understoodImpact: true,
      confirmation: "RESET",
    })).toBe(false);
  });
});
