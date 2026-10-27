import { describe, expect, it } from "vitest";
import { batasPeriode, filterPeriode, tanggalBaris } from "../komisi-data";

const recorder = () => {
  const calls: [string, string, string][] = [];
  const q = {
    gte: (c: string, v: string) => { calls.push(["gte", c, v]); return q; },
    lt: (c: string, v: string) => { calls.push(["lt", c, v]); return q; },
    lte: (c: string, v: string) => { calls.push(["lte", c, v]); return q; },
  };
  return { q, calls };
};
// Postgres reads an offset-less timestamptz literal in the server zone (UTC on Supabase).
const instant = (v: string) => Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`);
const inWindow = (t: number, periode: string) => {
  const b = batasPeriode(periode);
  return t >= instant(b.dari) && (b.sampaiEksklusif ? t < instant(b.sampai) : t <= instant(b.sampai));
};

describe("commission period boundaries around the 2026-11 go-live", () => {
  it("keeps the legacy window exactly for periods already calculated", () => {
    const { q, calls } = recorder();
    filterPeriode(q, "created_at", "2026-10");
    expect(calls).toEqual([["gte", "created_at", "2026-10-01T00:00:00"], ["lte", "created_at", "2026-10-31T23:59:59"]]);
  });

  it("uses the Asia/Jakarta month with an exclusive next-month WIB midnight after go-live", () => {
    const { q, calls } = recorder();
    filterPeriode(q, "paid_at", "2026-12");
    expect(calls).toEqual([["gte", "paid_at", "2026-12-01T00:00:00+07:00"], ["lt", "paid_at", "2027-01-01T00:00:00+07:00"]]);
    expect(batasPeriode("2026-11").sampai).toBe("2026-12-01T00:00:00+07:00");
  });

  it("counts every instant around the cutover in exactly one month", () => {
    for (const iso of ["2026-10-31T16:59:59Z", "2026-10-31T17:00:00Z", "2026-10-31T20:00:00Z", "2026-10-31T23:59:59Z",
      "2026-11-01T00:00:00Z", "2026-11-30T16:59:59Z", "2026-11-30T17:00:00Z"]) {
      const t = Date.parse(iso);
      const months = ["2026-10", "2026-11", "2026-12"].filter((p) => inWindow(t, p));
      expect(months, iso).toHaveLength(1);
    }
    // 03:00 WIB on 1 Nov was already in the October calculation and stays there.
    expect(inWindow(Date.parse("2026-10-31T20:00:00Z"), "2026-10")).toBe(true);
    // 00:30 WIB on 1 Dec belongs to December (WIB month), not November.
    expect(inWindow(Date.parse("2026-11-30T17:30:00Z"), "2026-12")).toBe(true);
  });

  it("dates rows by WIB only from the end of the legacy window", () => {
    expect(tanggalBaris("2026-10-31T20:00:00Z")).toBe("2026-10-31"); // legacy: UTC date
    expect(tanggalBaris("2026-11-15T20:00:00Z")).toBe("2026-11-16"); // WIB: 03:00 on the 16th
  });
});
