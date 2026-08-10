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

  // Tanggal jatuhnya jurnal belum lewat -> bulan berjalan belum boleh diposting,
  // kalau tidak jurnalnya bertanggal masa depan.
  it("tanggal jatuh tempo belum lewat -> bulan berjalan dilewati", () => {
    expect(periodeTertinggal("2026-06", JUL, 25)).toEqual([]);
    expect(periodeTertinggal("2026-05", JUL, 25)).toEqual(["2026-06"]);
  });
  it("tanggal jatuh tempo sudah lewat -> bulan berjalan ikut", () => {
    expect(periodeTertinggal("2026-05", JUL, 23)).toEqual(["2026-06", "2026-07"]);
    expect(periodeTertinggal("2026-05", JUL, 10)).toEqual(["2026-06", "2026-07"]);
  });
  it("belum pernah posting + tanggal belum lewat -> kosong", () => {
    expect(periodeTertinggal(null, JUL, 25)).toEqual([]);
  });
});
