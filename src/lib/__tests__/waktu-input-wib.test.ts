import { describe, expect, it } from "vitest";
import { waktuInputWIB } from "../tanggal";

describe("waktuInputWIB", () => {
  it("menyimpan catatan malam WIB tanpa bergeser ke besok", () => {
    expect(waktuInputWIB("2026-09-14", "23:50")?.toISOString()).toBe("2026-09-14T16:50:00.000Z");
  });
  it("menyimpan tengah malam WIB sebagai hari sebelumnya di UTC", () => {
    expect(waktuInputWIB("2026-09-14", "00:05")?.toISOString()).toBe("2026-09-13T17:05:00.000Z");
  });
  it.each([["", "23:50"], ["2026-09-14", ""], ["2026-02-30", "12:00"], ["2026-09-14", "24:01"]])("menolak input tanggal/jam tidak valid %s %s", (tanggal, jam) => {
    expect(waktuInputWIB(tanggal, jam)).toBeNull();
  });
});
