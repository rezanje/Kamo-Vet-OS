import { expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/ledger", () => ({ getAccountBalances: async () => [{ code: "1301", saldo: 100 }] }));
import { bacaSaldoAwal } from "@/app/(app)/keuangan/saldo-awal/actions";

it("proposes moving average value rather than physical acquisition layer totals", async () => {
  const { client } = clientFixture({ role: "FINANCE", averageMode: true, tables: {
    stock: [{ id: "s", warehouse_id: "w1", item_id: "i", qty: 3, average_cost: 80 }],
    stock_layers: [{ id: "l", warehouse_id: "w1", item_id: "i", qty_left: 3, unit_cost: 10 }],
  } });
  const result = await bacaSaldoAwal(client);
  expect(result.usulan.find(row => row.code === "1301")).toMatchObject({ nyata: 240, buku: 100, selisih: 140, sumber: "Saldo stok × HPP rata-rata bergerak" });
});

it("preserves recognized negative moving average inventory in the opening proposal", async () => {
  const { client } = clientFixture({ averageMode: true, tables: {
    stock: [{ id: "s", warehouse_id: "w1", item_id: "i", qty: -2, average_cost: 80 }], stock_layers: [],
  } });
  const result = await bacaSaldoAwal(client);
  expect(result.usulan.find(row => row.code === "1301")).toMatchObject({ nyata: -160, buku: 100, selisih: -260 });
});

it("rejects unknown moving average valuation instead of proposing a fictitious zero balance", async () => {
  const { client } = clientFixture({ averageMode: true, tables: {
    stock: [{ id: "s", warehouse_id: "w1", item_id: "i", qty: 2, average_cost: null }], stock_layers: [],
  } });
  await expect(bacaSaldoAwal(client)).rejects.toThrow("Nilai persediaan belum tersedia lengkap");
});

it("retains the FIFO opening valuation and its original source label", async () => {
  const result = await bacaSaldoAwal(clientFixture().client);
  expect(result.usulan.find(row => row.code === "1301")).toMatchObject({ nyata: 150, buku: 100, selisih: 50, sumber: "Sisa lapisan stok × modalnya" });
});
