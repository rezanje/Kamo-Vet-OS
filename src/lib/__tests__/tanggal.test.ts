import { describe, expect, it } from "vitest";
import { geserHari, rentangTanggal, tanggalLokal } from "../tanggal";

describe("tanggalLokal", () => {
  it("tidak mundur sehari di zona waktu Indonesia (bug toISOString)", () => {
    expect(tanggalLokal(new Date("2026-08-06T00:00:00"))).toBe("2026-08-06");
    expect(tanggalLokal(new Date("2026-01-01T00:00:00"))).toBe("2026-01-01");
  });
});

describe("rentangTanggal", () => {
  it("inklusif di kedua ujung", () => {
    expect(rentangTanggal("2026-08-06", "2026-08-08")).toEqual(["2026-08-06", "2026-08-07", "2026-08-08"]);
  });

  it("satu hari", () => {
    expect(rentangTanggal("2026-08-06", "2026-08-06")).toEqual(["2026-08-06"]);
  });

  it("lintas bulan", () => {
    expect(rentangTanggal("2026-07-30", "2026-08-02"))
      .toEqual(["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]);
  });
});

describe("geserHari", () => {
  it("mundur & maju melewati batas bulan", () => {
    expect(geserHari("2026-08-01", -1)).toBe("2026-07-31");
    expect(geserHari("2026-08-31", 1)).toBe("2026-09-01");
  });
});
