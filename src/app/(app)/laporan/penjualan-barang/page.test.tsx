import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/LaporanPage", () => ({
  LaporanPage: ({ children, pilihKolom, siap, filter }: { children: React.ReactNode; pilihKolom: boolean; siap: boolean; filter: React.ReactNode }) =>
    <main data-pilih-kolom={String(pilihKolom)} data-siap={String(siap)}>{filter}{siap ? children : <p>Laporan belum ditampilkan</p>}</main>,
  KartuAngka: () => null,
  TabelKosong: () => null,
}));
const data = vi.hoisted(() => ({ ambil: vi.fn() }));
vi.mock("./data", () => ({
  waktuWIB: () => "26 Okt",
  ambilOpsiCabangPenjualanBarang: async () => [{ id: "cabang-a", name: "Cabang A" }],
  ambilPenjualanBarang: async (...args: unknown[]) => (data.ambil(...args), {
    rows: Array.from({ length: 101 }, (_, index) => ({
      id: String(index), href: "/kasir/struk/dummy", waktu: "2026-10-26T00:00:00Z", dokumen: "DUMMY",
      cabang: "Cabang", pelanggan: "Pelanggan", hewan: "—", nama: "Vaksin", jenis: "Jasa", status: "—",
      pelaksana: "Dokter A", qty: 1, harga: 100, diskon: 0, nilai: 100,
      kode: "J1", kategori: "TINDAKAN", subKategori: "",
    })),
    cabangOptions: [], pelaksanaOptions: [], pesanError: null, nilaiTotal: 10100, qtyTotal: 101,
    ringkasan: { groups: [], totalQty: 101, totalNilai: 10100, totalBaris: 101 }, kategoriOptions: [],
  }),
}));
beforeEach(() => data.ambil.mockClear());

import Page from "./page";

it("keeps the applied R01 performer and R05 column choice while paging a complete item report", async () => {
  const kolom = JSON.stringify({ "t12345678-1": [2] });
  const page = await Page({ searchParams: Promise.resolve({
    tampil: "1", dari: "2026-10-01", sampai: "2026-10-31", pelaksana_id: "fa100000-0000-4000-8000-000000000001", kolom,
  }) });
  const html = renderToStaticMarkup(page);
  expect(html).toContain('data-pilih-kolom="true"');
  const next = html.match(/href="([^"]+)">Berikutnya/);
  expect(next).not.toBeNull();
  const url = new URL(next![1].replaceAll("&amp;", "&"), "https://example.test");
  expect(url.searchParams.get("pelaksana_id")).toBe("fa100000-0000-4000-8000-000000000001");
  expect(url.searchParams.get("kolom")).toBe(kolom);
  expect(url.searchParams.get("halaman")).toBe("2");
  // A1: pindah halaman tetap menampilkan laporan, tidak kembali kosong.
  expect(url.searchParams.get("tampil")).toBe("1");
});

it("A1: opens empty — no sales rows are read and no export links appear until Tampilkan", async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31", cabang_id: "cabang-a" }) }));
  expect(data.ambil).not.toHaveBeenCalled();
  expect(html).toContain('data-siap="false"');
  expect(html).toContain("Laporan belum ditampilkan");
  expect(html).not.toContain("/laporan/penjualan-barang/unduh");
  // Isian cabang tetap tersedia dari daftar cabang ringan.
  expect(html).toContain("Cabang A");
});

it("A1: pushes only a registered branch into the query", async () => {
  await Page({ searchParams: Promise.resolve({ tampil: "1", cabang_id: "cabang-a" }) });
  expect(data.ambil).toHaveBeenLastCalledWith(expect.objectContaining({ cabangId: "cabang-a", saringCabangDiQuery: true }));
  await Page({ searchParams: Promise.resolve({ tampil: "1", cabang_id: "bukan-uuid" }) });
  expect(data.ambil).toHaveBeenLastCalledWith(expect.objectContaining({ cabangId: "bukan-uuid", saringCabangDiQuery: false }));
});
