import { describe, it, expect } from "vitest";
import { periodeTerkunci } from "./jurnal-guard";

describe("periodeTerkunci", () => {
  it("belum pernah tutup buku = semua tanggal boleh", () => {
    expect(periodeTerkunci(null, "2026-07-29")).toBe(false);
    expect(periodeTerkunci(undefined, "2020-01-01")).toBe(false);
  });

  it("tanggal di dalam periode tertutup ditolak, termasuk tanggal batasnya", () => {
    expect(periodeTerkunci("2026-06-30", "2026-06-30")).toBe(true);
    expect(periodeTerkunci("2026-06-30", "2026-05-01")).toBe(true);
  });

  it("tanggal setelah batas tutup buku boleh", () => {
    expect(periodeTerkunci("2026-06-30", "2026-07-01")).toBe(false);
  });
});
