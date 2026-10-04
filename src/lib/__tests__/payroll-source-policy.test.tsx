import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { hitungGaji, type InputGaji } from "../payroll";
const state = vi.hoisted(() => ({ snapshot: {} as unknown }));
vi.mock("@/lib/master-guard", () => ({
  assertRole: async () => ({
    from: (table: string) => {
      if (table !== "payrolls")
        throw new Error("Historical source must use saved payroll only");
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: {
            status: "final",
            draft_version: 1,
            source_snapshot: state.snapshot,
          },
          error: null,
        }),
      };
      return q;
    },
  }),
}));
import Page from "../../app/(app)/hris/penggajian/sumber/page";
it("saved source explains effective boundary and approved overtime at their saved rates", async () => {
  const baseline = {
    telat_mulai_menit: 1,
    telat_blok_menit: 5,
    telat_nominal_per_blok: 0,
    telat_maks: 0,
    bolos_per_hari: 0,
    lembur_per_jam: 0,
  };
  const input: InputGaji = {
    gajiPokok: 1000,
    jadwal: [],
    absen: [],
    tanggalCuti: [],
    jamLembur: 2,
    komponen: [],
    reimburse: 0,
    komisi: 0,
    kasbon: [],
    penyesuaian: 0,
    aturan: baseline,
    aturanPerTanggal: {
      "2026-10-09": baseline,
      "2026-10-15": { ...baseline, bolos_per_hari: 30, lembur_per_jam: 100 },
    },
    lemburPerTanggal: [{ tanggal: "2026-10-15", jam: 2 }],
  };
  state.snapshot = {
    input,
    rincian: hitungGaji(input),
    commission: { rows: [], result: null },
  };
  const html = renderToStaticMarkup(
    await Page({
      searchParams: Promise.resolve({
        periode: "2026-10",
        employee: "92000000-0000-0000-0000-000000000001",
      }),
    }),
  );
  expect(html).toContain("Tarif lembur/jam");
  expect(html).toMatch(
    /<tr[^>]*><td[^>]*>2026-10-09<\/td>[\s\S]*?Rp 0[\s\S]*?<\/tr>/,
  );
  expect(html).toMatch(
    /<tr[^>]*><td[^>]*>2026-10-15<\/td>[\s\S]*?Rp 30[\s\S]*?Rp 100[\s\S]*?<\/tr>/,
  );
  expect(html).toContain("Lembur disetujui per tanggal");
  expect(html).toContain("Rp 200");
});

it("historical detail displays saved fixed, variable and reimbursement sources", async () => {
  const input: InputGaji = {
    gajiPokok: 1000,
    jadwal: [],
    absen: [],
    tanggalCuti: [],
    jamLembur: 0,
    komponen: [
      { tipe: "tunjangan", nominal: 500 },
      { tipe: "potongan", nominal: 50 },
    ],
    reimburse: 75,
    komisi: 0,
    kasbon: [],
    penyesuaian: 0,
    aturan: {
      telat_mulai_menit: 1,
      telat_blok_menit: 5,
      telat_nominal_per_blok: 0,
      telat_maks: 0,
      bolos_per_hari: 0,
      lembur_per_jam: 0,
    },
  };
  state.snapshot = {
    input,
    rincian: hitungGaji(input),
    components: [
      {
        id: "fixed",
        nama: "Fiction historical meal",
        tipe: "tunjangan",
        nominal: 500,
        source: "fixed",
        version: "old-master",
      },
      {
        id: "variable",
        nama: "Fiction October correction",
        tipe: "potongan",
        nominal: 50,
        source: "variable",
        version: "old-period",
      },
    ],
    reimbursements: [
      {
        id: "claim",
        tanggal: "2026-09-29",
        kategori: "Fiction transport",
        jumlah: 75,
      },
    ],
    commission: { rows: [], result: null },
  };
  const html = renderToStaticMarkup(
    await Page({
      searchParams: Promise.resolve({
        periode: "2026-10",
        employee: "92000000-0000-0000-0000-000000000001",
      }),
    }),
  );
  expect(html).toContain("Fiction historical meal");
  expect(html).toContain("Fiction October correction");
  expect(html).toContain("Komponen periode");
  expect(html).toContain("2026-09-29");
  expect(html).toContain("Fiction transport");
  expect(html).toContain("Rp 75");
});
