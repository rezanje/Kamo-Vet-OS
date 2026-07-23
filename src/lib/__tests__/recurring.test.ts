import { describe, expect, it } from "vitest";
import { periodeTertinggal } from "../recurring";

const JUL = new Date(2026, 6, 23); // 2026-07

describe("periodeTertinggal", () => {
  it("belum pernah posting -> bulan berjalan saja", () => {
    expect(periodeTertinggal(null, JUL)).toEqual(["2026-07"]);
  });
  it("tertinggal 2 bulan -> catch-up berurutan", () => {
    expect(periodeTertinggal("2026-05", JUL)).toEqual(["2026-06", "2026-07"]);
  });
  it("sudah bulan ini -> kosong", () => {
    expect(periodeTertinggal("2026-07", JUL)).toEqual([]);
  });
  it("lintas tahun", () => {
    expect(periodeTertinggal("2025-11", new Date(2026, 0, 5))).toEqual(["2025-12", "2026-01"]);
  });
});
