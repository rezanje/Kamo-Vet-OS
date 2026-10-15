import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ sales: [] as Record<string, unknown>[], journal: [] as Record<string, unknown>[] }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/posting", () => ({ postJournal: async (_client: unknown, entry: Record<string, unknown>) => { fixture.journal.push(entry); } }));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({}), splitPpnInklusif: (total: number) => ({ dpp: total, ppn: 0 }) }));
vi.mock("@/lib/kas-akun", () => ({ kodeAkunBayar: async (_client: unknown, method: string) => method === "Tunai" ? "cash-now" : "bank-now" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client() }));

function client() {
  return { from(table: string) {
    let online = false;
    const q = { select: () => q, is: () => q,
      not: (key: string) => { if (key === "channel") online = true; return q; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "sales" && !online ? fixture.sales : [], error: null }).then(resolve) };
    return q;
  } };
}

import { findDrift, perbaikiDrift } from "@/app/(app)/keuangan/sinkron/actions";

beforeEach(() => { fixture.sales = []; fixture.journal = []; });

it("repairs one split sale with separate original-account debits and one revenue credit", async () => {
  fixture.sales = [{ no_struk: "POS-split", total: 100000, metode_bayar: "Split", created_at: "2026-10-15", branch_id: "b",
    sale_payments: [{ method: "Tunai", amount: 20000, coa_code: "cash-original" }, { method: "Transfer", amount: 80000, coa_code: "bank-original" }] }];
  await expect(perbaikiDrift()).rejects.toThrow("redirect");
  expect(fixture.journal).toEqual([expect.objectContaining({ source: "sale", sourceRef: "POS-split", lines: [
    { code: "cash-original", debit: 20000, credit: 0 }, { code: "bank-original", debit: 80000, credit: 0 },
    { code: "4101", debit: 0, credit: 100000 },
  ] })]);
});

it("preserves legacy payment mapping for sales with no allocation rows", async () => {
  fixture.sales = [{ no_struk: "POS-old", total: 100000, metode_bayar: "Tunai", created_at: "2026-10-15", branch_id: "b" }];
  await expect(perbaikiDrift()).rejects.toThrow("redirect");
  expect(fixture.journal[0].lines).toEqual([
    { code: "cash-now", debit: 100000, credit: 0 }, { code: "4101", debit: 0, credit: 100000 },
  ]);
});

it("fails visibly before posting a split sale whose allocations are missing", async () => {
  fixture.sales = [{ no_struk: "POS-invalid", total: 100000, metode_bayar: "Split", created_at: "2026-10-15", sale_payments: [] }];
  await expect(findDrift(client() as never)).rejects.toThrow(/pembayaran/i);
  await expect(perbaikiDrift()).rejects.toThrow(/pembayaran/i);
  expect(fixture.journal).toHaveLength(0);
});

it("does not repair an unfinished planned sale while its journal is pending", async () => {
  fixture.sales = [{ no_struk: "POS-pending", total: 100000, metode_bayar: "Split", created_at: "2026-10-15",
    payment_plan: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }], payments_finalized_at: null,
    sale_payments: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }] }];
  expect((await findDrift(client() as never)).sales).toEqual([]);
  await expect(perbaikiDrift()).rejects.toThrow("redirect");
  expect(fixture.journal).toHaveLength(0);
});

it("requires a financial review for a planned finalized sale whose protected journal is missing", async () => {
  fixture.sales = [{ no_struk: "POS-finalized", total: 100000, metode_bayar: "Split", created_at: "2026-10-15",
    payment_plan: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }], payments_finalized_at: "2026-10-15T05:00:01Z",
    sale_payments: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }] }];
  await expect(findDrift(client() as never)).rejects.toThrow(/pemeriksaan keuangan/i);
  await expect(perbaikiDrift()).rejects.toThrow(/pemeriksaan keuangan/i);
  expect(fixture.journal).toHaveLength(0);
});
