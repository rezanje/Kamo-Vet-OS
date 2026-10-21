import { expect, it } from "vitest";
import { mutasiPiutang } from "@/lib/buku-pembantu-server";
import { bukuPembantu } from "@/lib/buku-pembantu";
it("retains dated original invoices/payments and adds reversal plus credit reclassification", async () => {
  const invoices = [{ id: "old", no_faktur: "FJ-1", tanggal: "2026-10-18", total: 200, voided_on: "2026-10-21", customer_id: "customer", customers: { name: "Fiction" } }, { id: "new", no_faktur: "FJ-2", tanggal: "2026-10-21", total: 100, customer_id: "customer", customers: { name: "Fiction" } }];
  const receipts = [{ invoice_id: "old", no_terima: "RC-1", tanggal: "2026-10-19", jumlah: 150, sales_invoices: { customer_id: "customer", customers: { name: "Fiction" } } }];
  const credits = [{ id: "audit", tanggal: "2026-10-21", customer_credit: 50, sales_invoices: { id: "old", no_faktur: "FJ-1", customer_id: "customer", customers: { name: "Fiction" } } }];
  const db = { from: (name: string) => { const q = { select: () => q, is: () => q, neq: () => q, lte: async () => ({ data: name === "sales_invoices" ? invoices : name === "sales_receipts" ? receipts : name === "wholesale_invoice_corrections" ? credits : [] }) }; return q; } };
  const movements = await mutasiPiutang(db as never, "2026-10-21");
  expect(bukuPembantu(movements, "2026-10-18", "2026-10-20")[0].saldoAkhir).toBe(50);
  expect(bukuPembantu(movements, "2026-10-18", "2026-10-21")[0].saldoAkhir).toBe(0);
  expect(movements.find(m => m.keterangan.includes("kredit pelanggan"))).toMatchObject({ naik: 50, turun: 0 });
});
