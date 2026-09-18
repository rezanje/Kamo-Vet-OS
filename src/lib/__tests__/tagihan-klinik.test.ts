// Pembagian potongan voucher rombongan — kesepakatan 2026-08-12: satu voucher
// per kedatangan, potongannya dibagi proporsional ke nota tiap hewan.

import { describe, it, expect } from "vitest";
import { bagiPotongan, perkiraanTagihan } from "../tagihan-klinik";

describe("bagiPotongan", () => {
  it("membagi sesuai porsi tagihan tiap hewan", () => {
    expect(bagiPotongan([500_000, 300_000, 200_000], 100_000)).toEqual([50_000, 30_000, 20_000]);
  });

  it("jumlah bagian selalu persis sama dengan nilai voucher (sisa pembulatan ke nota terbesar)", () => {
    const bagian = bagiPotongan([100, 100, 100], 10);
    expect(bagian.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it("tidak memotong lebih besar dari total tagihan", () => {
    expect(bagiPotongan([50_000, 50_000], 500_000)).toEqual([50_000, 50_000]);
  });

  it("tagihan nol tidak kebagian potongan", () => {
    expect(bagiPotongan([0, 200_000], 50_000)).toEqual([0, 50_000]);
  });

  it("tanpa voucher tidak ada yang dipotong", () => {
    expect(bagiPotongan([100_000, 100_000], 0)).toEqual([0, 0]);
  });
});

describe("perkiraanTagihan", () => {
  it("does not block inpatient payment when Rawat Inap is not mandatory", async () => {
    const data: Record<string, unknown> = {
      visits: [{ id: "visit-1", poli: "Poli Umum" }],
      medical_records: null,
      inpatient_records: { id: "inpatient-1" },
      consents: [],
      consent_rules: [{ kategori: "Rawat Inap", wajib: false }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = (table: string): any => {
      const result = { data: data[table] ?? null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        in: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => result,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    };

    const perkiraan = await perkiraanTagihan(
      { from: query },
      ["visit-1"],
      { mode_pkp: false, ppn_rate: 11 },
    );

    expect(perkiraan.get("visit-1")?.bisaDibayar).toBe(true);
  });
});
