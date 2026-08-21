import { describe, it, expect } from "vitest";
import { hariRawatInap } from "../inpatient";

describe("hariRawatInap", () => {
  const masuk = "2026-08-01T08:00:00+07:00";
  const jamKe = (n: number) => new Date(new Date(masuk).getTime() + n * 36e5).toISOString();

  it("membulatkan ke atas per 24 jam", () => {
    expect(hariRawatInap(masuk, jamKe(15))).toBe(1);   // 15 jam → 1 hari
    expect(hariRawatInap(masuk, jamKe(24))).toBe(1);   // pas 24 jam → 1 hari
    expect(hariRawatInap(masuk, jamKe(25))).toBe(2);
    expect(hariRawatInap(masuk, jamKe(30))).toBe(2);   // 30 jam → 2 hari
    expect(hariRawatInap(masuk, jamKe(49))).toBe(3);
  });

  it("menghitung dari jam, bukan selisih tanggal", () => {
    // Masuk Senin 23.00, pulang Selasa 07.00 = 8 jam, tetap satu hari.
    expect(hariRawatInap("2026-08-03T23:00:00+07:00", "2026-08-04T07:00:00+07:00")).toBe(1);
  });

  it("tanggal kacau tetap ditagih satu hari", () => {
    expect(hariRawatInap(masuk, "2026-07-01T08:00:00+07:00")).toBe(1);
    expect(hariRawatInap("bukan tanggal", masuk)).toBe(1);
  });
});
