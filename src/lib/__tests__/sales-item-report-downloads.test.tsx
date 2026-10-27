import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ExcelJS from "exceljs";
import { beforeEach, expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";
import type { Baris } from "../../app/(app)/laporan/penjualan-barang/data";
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("../../app/(app)/laporan/penjualan-barang/data", async importOriginal => ({ ...await importOriginal<typeof import("../../app/(app)/laporan/penjualan-barang/data")>(), ambilPenjualanBarang: mocks.load }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
import { GET } from "../../app/(app)/laporan/penjualan-barang/unduh/route";
import Page from "../../app/(app)/laporan/penjualan-barang/page";

const rows: Baris[] = Array.from({ length: 205 }, (_, index) => ({ id: String(index), waktu: "2026-10-04T05:00:00Z", dokumen: `INV-${index}`, href: `/invoice/${index}`, kanal: "Klinik", jenis: "Racikan", cabang: "Klinik A", cabangId: "b1", pelanggan: "Pemilik", hewan: "Kucing", nama: index === 204 ? "<obat>" : "Racikan", pelaksana: "—", qty: 2, harga: 100, diskon: 10, nilai: 190, status: "Lunas" }));
beforeEach(() => {
  mocks.createClient.mockResolvedValue(clientFixture().client);
  mocks.load.mockReset().mockResolvedValue({ rows, cabangOptions: [{ id: "b1", name: "Klinik A" }], pesanError: "", nilaiTotal: 38950, qtyTotal: 410 });
});

it.each(["csv", "xlsx", "print"])("exports all selected rows, applied filters and complete totals as %s independently of display page", async format => {
  const response = await GET(new Request(`https://example.test/laporan/penjualan-barang/unduh?dari=2026-10-01&sampai=2026-10-04&kanal=Klinik&jenis=Racikan&q=obat&halaman=2&format=${format}`));
  expect(response.status).toBe(200);
  expect(mocks.load).toHaveBeenCalledWith({ dari: "2026-10-01", sampai: "2026-10-04", kanal: "Klinik", jenis: "Racikan", q: "obat", cabangId: "", pelaksanaId: "" });
  if (format === "xlsx") {
    expect(response.headers.get("Content-Type")).toContain("spreadsheetml");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    expect(book.getWorksheet("Penjualan barang")!.rowCount).toBe(206);
    expect(book.getWorksheet("Penjualan barang")!.getRow(206).getCell(2).value).toBe("INV-204");
    expect(book.getWorksheet("Ringkasan dan filter")!.getRows(1, 20)?.some(row => row.getCell(2).value === 38950)).toBe(true);
    expect(book.getWorksheet("Ringkasan dan filter")!.getRows(1, 20)?.some(row => row.getCell(2).value === "obat")).toBe(true);
  } else {
    const output = await response.text();
    expect(output).toContain("INV-0");
    expect(output).toContain("INV-204");
    expect(output).toContain("38950");
    expect(output).toContain("obat");
    if (format === "print") { expect(output).toContain("&lt;obat&gt;"); expect(output).not.toContain("<obat>"); }
  }
});

it("provides only complete export links on the paginated report", async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-04", kanal: "Klinik", jenis: "Racikan", q: "obat", halaman: "2" }) }));
  expect(html).not.toContain("Unduh data yang tampil");
  expect(html).toContain("Excel lengkap");
  expect(html).toContain("Cetak / PDF lengkap");
  expect(html).toContain("format=xlsx");
  expect(html).toContain("format=print");
  expect(html).toContain("q=obat");
});

it("preserves the exact saved performer filter in page navigation and export metadata", async () => {
  mocks.load.mockResolvedValue({ rows, cabangOptions: [], pelaksanaOptions: [{ id: "doctor-a", nama: "Dokter: Nama Sama" }], pesanError: "", nilaiTotal: 38950, qtyTotal: 410 });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-04", kanal: "Klinik", jenis: "Racikan", pelaksana_id: "doctor-a", halaman: "2" }) }));
  expect(html).toContain("pelaksana_id=doctor-a");
  expect(html).toContain("Dokter: Nama Sama");
  const response = await GET(new Request("https://example.test/laporan/penjualan-barang/unduh?dari=2026-10-01&sampai=2026-10-04&kanal=Klinik&jenis=Racikan&pelaksana_id=doctor-a"));
  expect(response.status).toBe(200);
  expect(mocks.load).toHaveBeenLastCalledWith({ dari: "2026-10-01", sampai: "2026-10-04", kanal: "Klinik", jenis: "Racikan", q: "", cabangId: "", pelaksanaId: "doctor-a" });
  expect(await response.text()).toContain("Dokter: Nama Sama · doctor-a");
});

it("does not read report data when download authorization fails", async () => {
  mocks.createClient.mockResolvedValue(clientFixture({ anonymous: true }).client);
  expect((await GET(new Request("https://example.test/unduh?format=xlsx"))).status).toBe(401);
  expect(mocks.load).not.toHaveBeenCalled();
});

it("offers and exports every posted clinic line as one selection", async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-04", kanal: "Klinik", jenis: "Semua" }) }));
  expect(html).toMatch(/<option value="Semua"[^>]*>Semua baris invoice klinik<\/option>/);
  expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ kanal: "Klinik", jenis: "Semua" }));
  expect(html).toContain("jenis=Semua");
  const response = await GET(new Request("https://example.test/laporan/penjualan-barang/unduh?dari=2026-10-01&sampai=2026-10-04&kanal=Klinik&jenis=Semua&format=csv"));
  expect(response.status).toBe(200);
  expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ kanal: "Klinik", jenis: "Semua" }));
  // Kasir/online sources keep their single item type.
  await GET(new Request("https://example.test/laporan/penjualan-barang/unduh?dari=2026-10-01&sampai=2026-10-04&kanal=POS&jenis=Semua&format=csv"));
  expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ kanal: "POS", jenis: "Barang" }));
});
