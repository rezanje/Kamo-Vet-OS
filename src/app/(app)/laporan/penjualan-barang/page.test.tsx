import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/LaporanPage", () => ({
  LaporanPage: ({ children, pilihKolom }: { children: React.ReactNode; pilihKolom: boolean }) => <main data-pilih-kolom={String(pilihKolom)}>{children}</main>,
  KartuAngka: () => null,
  TabelKosong: () => null,
}));
vi.mock("./data", () => ({
  waktuWIB: () => "26 Okt",
  ambilPenjualanBarang: async () => ({
    rows: Array.from({ length: 101 }, (_, index) => ({
      id: String(index), href: "/kasir/struk/dummy", waktu: "2026-10-26T00:00:00Z", dokumen: "DUMMY",
      cabang: "Cabang", pelanggan: "Pelanggan", hewan: "—", nama: "Vaksin", jenis: "Jasa", status: "—",
      pelaksana: "Dokter A", qty: 1, harga: 100, diskon: 0, nilai: 100,
    })),
    cabangOptions: [], pelaksanaOptions: [], pesanError: null, nilaiTotal: 10100, qtyTotal: 101,
  }),
}));

import Page from "./page";

it("keeps the applied R01 performer and R05 column choice while paging a complete item report", async () => {
  const kolom = JSON.stringify({ "t12345678-1": [2] });
  const page = await Page({ searchParams: Promise.resolve({
    dari: "2026-10-01", sampai: "2026-10-31", pelaksana_id: "fa100000-0000-4000-8000-000000000001", kolom,
  }) });
  const html = renderToStaticMarkup(page);
  expect(html).toContain('data-pilih-kolom="true"');
  const next = html.match(/href="([^"]+)">Berikutnya/);
  expect(next).not.toBeNull();
  const url = new URL(next![1].replaceAll("&amp;", "&"), "https://example.test");
  expect(url.searchParams.get("pelaksana_id")).toBe("fa100000-0000-4000-8000-000000000001");
  expect(url.searchParams.get("kolom")).toBe(kolom);
  expect(url.searchParams.get("halaman")).toBe("2");
});
