import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("./line-actions", () => ({ pratinjauFakturJual: vi.fn(), simpanFakturJual: vi.fn(), hapusPenerimaanJual: vi.fn() }));
vi.mock("@/components/CorrectionTransactionForm", () => ({
  CorrectionTransactionForm: ({ scope, children }: { scope: string; children: (s: { ready: boolean; storageError: boolean }) => React.ReactNode }) =>
    <form data-scope={scope}>{children({ ready: true, storageError: false })}</form>,
}));

import { FakturLineEdit } from "./FakturLineEdit";
import { ReceiptDeleteForm } from "./ReceiptDeleteForm";

const rows = [
  { id: "l1", nama: "Royal Canin", satuan: "sak", qty: 10, harga: 300000, diskon: 0, maksQty: 12 },
  { id: "l2", nama: "Whiskas", satuan: "pcs", qty: 4, harga: 25000, diskon: 0, maksQty: 4 },
];
const render = (over: Partial<Parameters<typeof FakturLineEdit>[0]> = {}) => renderToStaticMarkup(
  <FakturLineEdit invoiceId="inv-1" revision={2} today="2026-10-28" jatuhTempo="2026-11-27" catatan="catatan lama"
    taxRate={11} rows={rows} row={rows[0]} {...over} />,
);

it("menampilkan tombol Edit di kolom Aksi", () => {
  expect(render()).toContain("Edit");
});

it("menyediakan qty, harga dan diskon per baris", () => {
  const html = render();
  expect(html).toContain('name="qty"');
  expect(html).toContain('name="harga"');
  expect(html).toContain('name="diskon"');
  expect(html).toContain('max="12"');
});

it("mengirim seluruh baris faktur, bukan hanya baris yang dibuka", () => {
  const html = render();
  expect(html).toContain("&quot;id&quot;:&quot;l1&quot;");
  expect(html).toContain("&quot;id&quot;:&quot;l2&quot;");
});

it("meminta pratinjau dampak sebelum tombol simpan muncul", () => {
  const html = render();
  expect(html).toContain("Lihat dampak");
  expect(html).not.toContain("Menyimpan");
});

it("menjelaskan bahwa stok tidak ikut berubah", () => {
  expect(render()).toContain("stok tidak berubah");
});

it("menuntut alasan dan membawa revisi faktur sebagai penjaga tabrakan", () => {
  const html = render();
  expect(html).toContain('name="alasan"');
  expect(html).toContain('name="revision" value="2"');
});

it("pop-up hapus penerimaan menuntut alasan dan menyebut pengembalian uang muka", () => {
  const html = renderToStaticMarkup(
    <ReceiptDeleteForm userId="actor" invoiceId="inv-1" receiptId="rc-1" noTerima="RC.2026.10.00001" revision={1} dariUangMuka={250000} />,
  );
  expect(html).toContain("Hapus penerimaan");
  expect(html).toContain('name="alasan"');
  expect(html).toContain("uang muka dikembalikan");
  expect(html).toContain("sales-receipt-cancel:rc-1:1");
});
