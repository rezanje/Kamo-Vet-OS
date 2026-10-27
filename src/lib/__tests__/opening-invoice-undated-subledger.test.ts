import { expect, it } from "vitest";
import { mutasiHutang, mutasiPiutang } from "../buku-pembantu-server";
import { bukuPembantu } from "../buku-pembantu";

// M05: faktur saldo awal tanpa tanggal faktur tidak boleh hilang dari buku pembantu
// (filter tanggal SQL membuang NULL), dan tidak boleh diberi tanggal karangan.
type Row = Record<string, unknown>;
function client(tables: Record<string, Row[]>) {
  return { from: (name: string) => {
    let data = tables[name] ?? [];
    const query = {
      select: () => query, order: () => query, eq: () => query, neq: () => query, in: () => query,
      is: (column: string, value: unknown) => { data = data.filter(row => row[column] === value); return query; },
      // Seperti PostgreSQL: pembanding tanggal tidak pernah meloloskan NULL.
      lte: (column: string, value: string) => { data = data.filter(row => row[column] !== null && String(row[column]) <= value); return query; },
      then: (resolve: (result: { data: Row[]; error: null }) => unknown) => Promise.resolve(resolve({ data, error: null })),
    };
    return query;
  } };
}

const pemasok = { supplier_id: "supplier", suppliers: { nama: "PT Fiksi" } };
const hutang = (tables: Record<string, Row[]>) => client({ purchase_returns: [], ...tables });
const batch = { opening_invoice_batches: { as_of: "2026-10-31" } };

it("places an undated opening payable on the batch date, keeps its payments, and leaves the dated one alone", async () => {
  const db = hutang({ purchase_invoices: [
    { id: "dated", no_faktur: "FB.1", tanggal: "2026-09-01", total: 100, voided_on: null, ...pemasok, purchase_invoice_payments: [], ...batch },
    { id: "undated", no_faktur: "FB.2", tanggal: null, total: 400, voided_on: null, ...pemasok, ...batch,
      purchase_invoice_payments: [{ id: "pay", tanggal: "2026-11-05", amount: 150, dari_uang_muka: 0 }] },
  ] });
  const movements = await mutasiHutang(db as never, "2026-11-30");
  expect(movements.map(m => [m.nomor, m.tanggal, m.naik, m.turun])).toEqual([
    ["FB.1", "2026-09-01", 100, 0],
    ["FB.2", "2026-10-31", 400, 0],
    ["FB.2", "2026-11-05", 0, 150],
  ]);
  expect(movements[1].keterangan).toContain("tanggal faktur tidak ada");
  expect(bukuPembantu(movements, "2026-11-01", "2026-11-30")[0]).toMatchObject({ saldoAwal: 500, turun: 150, saldoAkhir: 350 });
  // Before the cutover the undated invoice is not in the ledger yet — same as its 2101 journal.
  const before = await mutasiHutang(db as never, "2026-10-30");
  expect(before.map(m => m.nomor)).toEqual(["FB.1"]);
});

it("places an undated opening receivable on the batch date so receipts never run the customer negative", async () => {
  const db = client({
    sales_invoices: [
      { id: "undated", no_faktur: "FJ.9", tanggal: null, total: 120, status: "lunas", voided_on: null, customer_id: "customer", customers: { name: "Toko Fiksi" }, ...batch },
    ],
    sales_receipts: [{ invoice_id: "undated", no_terima: "RC.1", tanggal: "2026-11-02", jumlah: 120, metode: "Transfer", sales_invoices: { customer_id: "customer", customers: { name: "Toko Fiksi" } } }],
  });
  const movements = await mutasiPiutang(db as never, "2026-11-30");
  expect(movements.map(m => [m.nomor, m.tanggal, m.naik, m.turun])).toEqual([["FJ.9", "2026-10-31", 120, 0], ["RC.1", "2026-11-02", 0, 120]]);
  expect(bukuPembantu(movements, "2026-11-01", "2026-11-30")[0]).toMatchObject({ saldoAwal: 120, turun: 120, saldoAkhir: 0 });
});

it("keeps an undated invoice in the opening balance, undated, when its batch is not visible to the reader", async () => {
  const db = hutang({ purchase_invoices: [
    { id: "undated", no_faktur: "FB.3", tanggal: null, total: 70, voided_on: null, ...pemasok, purchase_invoice_payments: [], opening_invoice_batches: null },
  ] });
  const movements = await mutasiHutang(db as never, "2026-11-30");
  expect(movements.map(m => [m.nomor, m.tanggal, m.naik])).toEqual([["FB.3", "", 70]]);
  expect(bukuPembantu(movements, "2026-11-01", "2026-11-30")[0]).toMatchObject({ saldoAwal: 70, naik: 0, saldoAkhir: 70 });
});

it("fails loudly when the undated-invoice read itself fails, instead of showing a short balance", async () => {
  const db = { from: (name: string) => {
    const query = {
      select: () => query, lte: () => query,
      is: (column: string) => { (query as { failed?: boolean }).failed = column === "tanggal" && name === "purchase_invoices"; return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve((query as { failed?: boolean }).failed
        ? { data: null, error: { message: "boom" } } : { data: [], error: null }).then(resolve),
    };
    return query;
  } };
  await expect(mutasiHutang(db as never, "2026-11-30")).rejects.toThrow("Faktur saldo awal tanpa tanggal belum dapat diverifikasi");
});
