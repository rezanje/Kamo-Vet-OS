import { expect, it, vi } from "vitest";
const source = vi.hoisted(() => ({ reversalDate: "2026-10-21" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  let lower = "", upper = "";
  const lines = [
    { debit: 0, credit: 11000, coa_accounts: { code: "312005" }, journal_entries: { tanggal: "2026-10-20", source: "sale", source_ref: "original-sale", deskripsi: "Penjualan" } },
    { debit: 11000, credit: 0, coa_accounts: { code: "312005" }, journal_entries: { tanggal: source.reversalDate, source: "sale-void", source_ref: "cancellation-audit", deskripsi: "Pembatalan original-sale" } },
  ];
  const q = { select: () => q, in: () => q, eq: () => q, gte: (_key: string, v: string) => { lower = v; return q; }, lte: (_key: string, v: string) => { upper = v; return q; }, maybeSingle: async () => ({ data: { mode_pkp: true } }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "journal_lines" ? lines.filter(x => x.journal_entries.tanggal >= lower && x.journal_entries.tanggal <= upper) : [] }).then(resolve) };
  return q;
} }) }));
import { tarikPajakMasa } from "../faktur-pajak-server";
it("tax keeps original and exact signed cancellation under distinct audit refs", async () => {
 source.reversalDate = "2026-10-21";
 const report = await tarikPajakMasa("2026-10");
 expect(report.keluaran.map(r => [r.nomor, r.ppn])).toEqual([["original-sale", 11000], ["cancellation-audit", -11000]]);
 expect(report.keluaran.reduce((sum, r) => sum + r.ppn, 0)).toBe(0);
});
it("tax reversal belongs to its current period without erasing historical source tax", async () => {
 source.reversalDate = "2026-11-01";
 expect((await tarikPajakMasa("2026-10")).keluaran.map(r => r.ppn)).toEqual([11000]);
 expect((await tarikPajakMasa("2026-11")).keluaran.map(r => r.ppn)).toEqual([-11000]);
});
