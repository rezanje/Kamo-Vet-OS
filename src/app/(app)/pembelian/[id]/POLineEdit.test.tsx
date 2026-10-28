import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("./line-actions", () => ({ pratinjauBarisPO: vi.fn(), simpanBarisPO: vi.fn() }));

import { POLineEdit } from "./POLineEdit";

const base = { id: "line-1", nama: "Revolution Dog", satuan: "Tube", qty: 36, harga_beli: 187545 };

it("belum diterima: Qty PO dan harga bisa diisi", () => {
  const html = renderToStaticMarkup(<POLineEdit poId="po-1" revision={2} today="2026-10-28" row={{ ...base, qty_terima: 0 }} />);
  expect(html).toContain("Edit");
  expect(html).toContain('name="qty"');
  expect(html).not.toContain('name="qty_terima"');
  expect(html).toContain("Qty PO dan harga bisa diubah langsung");
});

it("sudah diterima: qty diterima diisi, Qty PO ikut otomatis", () => {
  const html = renderToStaticMarkup(<POLineEdit poId="po-1" revision={2} today="2026-10-28" row={{ ...base, qty_terima: 36 }} />);
  expect(html).toContain('name="qty_terima"');
  expect(html).not.toContain('name="qty"');
  expect(html).toContain("ikut otomatis");
  expect(html).toContain("Harga diterima");
  // Tanpa pratinjau tidak ada tombol simpan.
  expect(html).toContain("Lihat dampak");
  expect(html).not.toContain("Simpan");
});

it("sudah ditagih: harga awal memakai harga faktur", () => {
  const html = renderToStaticMarkup(<POLineEdit poId="po-1" revision={2} today="2026-10-28" row={{ ...base, qty_terima: 36 }} hargaDiterima={190000} />);
  expect(html).toContain('value="190000"');
});
