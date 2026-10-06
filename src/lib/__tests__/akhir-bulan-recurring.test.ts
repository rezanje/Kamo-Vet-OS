import { describe, expect, it, vi } from "vitest";
import { jalankanAkhirBulan } from "../akhir-bulan-server";

vi.mock("@/lib/depreciation", () => ({ catchUpDepreciation: async () => [] }));
vi.mock("@/lib/loyalty-server", () => ({ jalankanPerawatanLoyalty: async () => undefined }));
vi.mock("@/lib/recurring", async () => await import("../recurring"));
vi.mock("@/lib/tanggal", async () => await import("../tanggal"));
vi.mock("@/lib/akhir-bulan", async () => await import("../akhir-bulan"));

describe("month-end with recurring failures", () => {
  it("does not lock accounting or write a successful run after recurring fails", async () => {
    const writes: string[] = [];
    const db = {
      from(table: string) {
        const chain = {
          select: () => chain, eq: () => chain,
          then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "Jurnal lama tidak lengkap" } }).then(resolve),
          upsert: async () => { writes.push(table); return { error: null }; },
          insert: async () => { writes.push(table); return { error: null }; },
        };
        return chain;
      },
    };
    await expect(jalankanAkhirBulan(db, { sumber: "manual", paksaKunci: true })).rejects.toThrow("Jurnal lama tidak lengkap");
    expect(writes).toEqual([]);
  });
});
