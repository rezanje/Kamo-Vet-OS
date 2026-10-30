import { describe, expect, it } from "vitest";
import { bagiProporsional, catatPoinNota, poinTerpakai, RUPIAH_PER_POIN } from "../poin-klinik";

describe("poinTerpakai", () => {
  it("tidak melebihi saldo pelanggan", () => {
    expect(poinTerpakai(5000, 1200, 999_999)).toBe(1200);
  });

  it("tidak melebihi tagihan — poin sisa tidak ikut hangus", () => {
    expect(poinTerpakai(5000, 5000, 3000 * RUPIAH_PER_POIN)).toBe(3000);
  });

  it("angka aneh dianggap nol", () => {
    expect(poinTerpakai(-10, 500, 500)).toBe(0);
    expect(poinTerpakai(Number.NaN, 500, 500)).toBe(0);
    expect(poinTerpakai(100, 500, 0)).toBe(0);
  });

  it("selalu bulat", () => {
    expect(Number.isInteger(poinTerpakai(10.9, 100, 100))).toBe(true);
  });
});

describe("bagiProporsional", () => {
  it("jumlah bagian selalu tepat, sisa ke bobot terbesar", () => {
    expect(bagiProporsional([150, 150, 300], 7)).toEqual([1, 1, 5]);
    expect(bagiProporsional([100, 0], 3)).toEqual([3, 0]);
  });

  it("bobot atau jumlah nol menghasilkan nol", () => {
    expect(bagiProporsional([0, 0], 5)).toEqual([0, 0]);
    expect(bagiProporsional([10, 20], 0)).toEqual([0, 0]);
  });
});

describe("catatPoinNota", () => {
  function fakeClient() {
    const ledger: { delta: number; saldo: number; ref: string }[] = [];
    const balances: number[] = [];
    const client = {
      from: (table: string) => ({
        insert: async (row: { delta: number; saldo: number; ref: string }) => { if (table === "point_ledger") ledger.push(row); },
        update: (patch: { points: number }) => ({ eq: async () => { balances.push(patch.points); } }),
      }),
    };
    return { client, ledger, balances };
  }

  it("mencatat poin per nota dengan ref nomor invoice, total didapat sama dengan gabungan", async () => {
    const { client, ledger, balances } = fakeClient();
    // Rp15.000 + Rp15.000 pada Rp10.000/poin: digabung 3 poin (per nota terpisah hanya 1 + 1).
    const hasil = await catatPoinNota(client, {
      customerId: "c", saldoAwal: 50, rupiahPerPoin: 10_000,
      nota: [{ ref: "INV-A", dipakai: 20, total: 15_000 }, { ref: "INV-B", dipakai: 10, total: 15_000 }],
    });
    expect(hasil).toEqual({ dipakai: 30, didapat: 3, saldoAkhir: 23 });
    expect(ledger).toEqual([
      expect.objectContaining({ ref: "INV-A", delta: -20, saldo: 30 }),
      expect.objectContaining({ ref: "INV-A", delta: 2, saldo: 32 }),
      expect.objectContaining({ ref: "INV-B", delta: -10, saldo: 22 }),
      expect.objectContaining({ ref: "INV-B", delta: 1, saldo: 23 }),
    ]);
    expect(balances).toEqual([23]);
  });

  it("tanpa pelanggan tidak menulis apa pun", async () => {
    const { client, ledger, balances } = fakeClient();
    await catatPoinNota(client, { customerId: null, saldoAwal: 0, rupiahPerPoin: 1, nota: [{ ref: "INV-A", dipakai: 0, total: 100 }] });
    expect(ledger).toEqual([]);
    expect(balances).toEqual([]);
  });
});
