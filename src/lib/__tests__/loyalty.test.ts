import { describe, expect, it } from "vitest";
import { bolehTurunTier, poinKedaluwarsa, tierSebelumnya } from "../loyalty";

describe("loyalty expiry", () => {
  it("hanguskan poin lama setelah pemakaian", () => {
    expect(poinKedaluwarsa(100, [-20], 130)).toBe(80);
    expect(poinKedaluwarsa(100, [-120], 30)).toBe(0);
  });

  it("turun satu tingkat", () => {
    expect(tierSebelumnya("Gold")).toBe("Silver");
    expect(tierSebelumnya("New")).toBe("New");
  });
});

describe("loyalty downgrade", () => {
  const base = { enabled: true, tier: "Gold", hariTidakTransaksi: 181, ambangHari: 180, hariIni: "2026-09-14" };
  it("boleh turun setelah melewati ambang", () => expect(bolehTurunTier(base)).toBe(true));
  it("tidak turun lagi sebelum satu periode berikutnya", () => {
    expect(bolehTurunTier({ ...base, terakhirTurun: "2026-08-01" })).toBe(false);
  });
});
