import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { NoDok } from "@/components/NoDok";

const ID = "8e692432-a8c6-4363-bf23-24c13b73faf6";

it("links an expense journal to the expense screen instead of showing a dead id", () => {
  const html = renderToStaticMarkup(<NoDok nomor={ID} source="expense" />);
  expect(html).toContain(`href="/buku-besar/beban/${ID}"`);
  expect(html).toContain(">Pengeluaran kasir<");
});

it("links a POS receipt number with a random suffix", () => {
  const html = renderToStaticMarkup(<NoDok nomor="POS-20261101-0001-6L1M" source="sale" />);
  expect(html).toContain('href="/dokumen/POS-20261101-0001-6L1M"');
});

it("leaves an unknown id as plain text", () => {
  const html = renderToStaticMarkup(<NoDok nomor={ID} source="shift" />);
  expect(html).not.toContain("href=");
});
