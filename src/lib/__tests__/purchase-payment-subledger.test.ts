import { expect, it } from "vitest";
import { mutasiHutang } from "@/lib/buku-pembantu-server";
import { bukuPembantu } from "@/lib/buku-pembantu";
import { sisaFakturBayar } from "@/lib/perintah-bayar";
it("keeps dated payment and reversal movements while restoring current debt", async () => {
  const payments = [{ id: "pay", tanggal: "2026-10-19", amount: 100, dari_uang_muka: 40 }, { id: "reverse", tanggal: "2026-10-21", amount: -100, dari_uang_muka: -40 }];
  const db = { from: (name: string) => ({ select: () => ({ lte: async () => ({ data: name === "purchase_invoices" ? [{ id: "invoice", no_faktur: "FB-1", tanggal: "2026-10-18", total: 150, supplier_id: "supplier", suppliers: { nama: "Fiction" }, purchase_invoice_payments: payments }] : [] }) }) }) };
  const movements = await mutasiHutang(db as never, "2026-10-21");
  expect(movements).toHaveLength(3);
  expect(movements[2]).toMatchObject({ naik: 100, turun: 0, keterangan: "Pembalik pembayaran hutang" });
  expect(bukuPembantu(movements, "2026-10-18", "2026-10-20")[0].saldoAkhir).toBe(50);
  expect(bukuPembantu(movements, "2026-10-18", "2026-10-21")[0].saldoAkhir).toBe(150);
  expect(sisaFakturBayar([{ id: "invoice", total: 150 }], payments.map(p => ({ ...p, invoice_id: "invoice" })), []).get("invoice")).toBe(150);
});
