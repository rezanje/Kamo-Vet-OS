import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ExcelJS from "exceljs";
import { beforeEach, expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";
import type { Baris } from "../../app/(app)/laporan/penjualan-barang/data";
import { ringkasKategori } from "../laporan-kategori-penjualan";
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("../../app/(app)/laporan/penjualan-barang/data", async importOriginal => ({ ...await importOriginal<typeof import("../../app/(app)/laporan/penjualan-barang/data")>(), ambilPenjualanBarang: mocks.load }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
import { GET } from "../../app/(app)/laporan/penjualan-barang/unduh/route";
import Page from "../../app/(app)/laporan/penjualan-barang/page";

const dasar = { waktu: "2026-10-04T05:00:00Z", href: "/x", kanal: "Klinik" as const, cabang: "Klinik A", cabangId: "b1", pelanggan: "Pemilik", hewan: "Kucing", status: "Lunas", diskon: 0 };
const rows: Baris[] = [
  { ...dasar, id: "1", dokumen: "INV-1", jenis: "Jasa", nama: "Injeksi", kode: "J0020", kategori: "TINDAKAN", subKategori: "Operasi", pelaksana: "Dokter A", qty: 1, harga: 50000, nilai: 50000 },
  { ...dasar, id: "1-bmhp-0", indukId: "1", dokumen: "INV-1", jenis: "Jasa", nama: "BMHP · Kasa", kode: "J0020", kategori: "TINDAKAN", subKategori: "Operasi", pelaksana: "—", qty: 3, harga: 0, nilai: 0, hpp: 500, satuan: "lembar" },
  { ...dasar, id: "2", dokumen: "INV-2", jenis: "Obat", nama: "Vitamin", kode: "100904", kategori: "OBAT & VITAMIN", subKategori: "", pelaksana: "—", qty: 2, harga: 5000, diskon: 1000, nilai: 9000 },
];
const ringkasan = ringkasKategori(rows);
const hasil = (over: object = {}) => ({ rows, cabangOptions: [{ id: "b1", name: "Klinik A" }], pelaksanaOptions: [], pesanError: "", nilaiTotal: 59000, qtyTotal: 3, ringkasan, kategoriOptions: ["OBAT & VITAMIN", "TINDAKAN"], ...over });
const params = "dari=2026-10-01&sampai=2026-10-04&kanal=Klinik&jenis=Semua";
beforeEach(() => {
  mocks.createClient.mockResolvedValue(clientFixture().client);
  mocks.load.mockReset().mockResolvedValue(hasil());
});
const halaman = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-04", kanal: "Klinik", jenis: "Semua", ...sp }) }));

it("layar menampilkan kolom Kode, Kategori, Sub kategori pada tiap baris", async () => {
  const html = await halaman();
  for (const kepala of ["<th>Kode</th>", "<th>Kategori</th>", "<th>Sub kategori</th>"]) expect(html).toContain(kepala);
  expect(html).toContain("J0020");
  expect(html).toContain("TINDAKAN");
  expect(html).toContain("Operasi");
});

it("ringkasan per kategori tampil dengan jumlah akhir sama dengan total rincian", async () => {
  const html = await halaman();
  expect(html).toContain("Ringkasan per kategori");
  expect(html).toContain("OBAT &amp; VITAMIN");
  expect(html).toContain("Rp 59.000");
  const ringkas = html.slice(html.indexOf("Ringkasan per kategori"), html.indexOf("Rincian per baris"));
  expect(ringkas).toContain("Jumlah semua kategori");
  expect(ringkas).toContain("Rp 59.000");
  expect(ringkas).toContain("Rp 50.000");
});

it("pilihan kategori: Semua bawaan, kategori induk lain, dan pilihan terpasang di tautan halaman/unduh", async () => {
  const html = await halaman();
  expect(html).toContain('<select class="fi" name="kategori"><option value="" selected="">Semua</option>');
  expect(html).toContain('<option value="TINDAKAN">TINDAKAN</option>');
  const terpilih = await halaman({ kategori: "TINDAKAN" });
  expect(terpilih).toContain('<option value="TINDAKAN" selected="">TINDAKAN</option>');
  expect(terpilih).toContain("kategori=TINDAKAN");
  expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ kategori: "TINDAKAN" }));
});

it("tombol Unduh Excel mengarah ke format Accurate dengan filter yang sama", async () => {
  const html = await halaman({ kategori: "TINDAKAN" });
  expect(html).toContain("Unduh Excel");
  const tautan = html.match(/href="([^"]+format=accurate[^"]*)"/);
  expect(tautan).not.toBeNull();
  const url = new URL(tautan![1].replaceAll("&amp;", "&"), "https://example.test");
  expect(url.pathname).toBe("/laporan/penjualan-barang/unduh");
  expect(url.searchParams.get("kategori")).toBe("TINDAKAN");
  expect(url.searchParams.get("dari")).toBe("2026-10-01");
});

it("berkas Accurate: kolom dan urutan sama, tanpa baris anak BMHP, jumlah baris dan total sama dengan laporan", async () => {
  const response = await GET(new Request(`https://example.test/laporan/penjualan-barang/unduh?${params}&kategori=TINDAKAN&format=accurate`));
  expect(response.status).toBe(200);
  expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ kategori: "TINDAKAN" }));
  expect(response.headers.get("Content-Type")).toContain("spreadsheetml");
  expect(response.headers.get("Content-Disposition")).toContain(".xlsx");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await response.arrayBuffer());
  const sheet = book.worksheets[0];
  expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(["Nomor #", "Cabang", "Tanggal", "Kode #", "Nama Barang", "Kategori", "Sub kategori", "Kuantitas", "@Harga", "Total Harga", "Pelanggan", "Diskon", "Nama Tenaga Penjual"]);
  expect(sheet.rowCount).toBe(3); // judul + 2 baris induk, BMHP anak tidak ikut
  expect((sheet.getRow(2).values as unknown[]).slice(1, 3)).toEqual(["INV-1", "Klinik A"]);
  expect((sheet.getRow(2).values as unknown[]).slice(4)).toEqual(["J0020", "Injeksi", "TINDAKAN", "Operasi", 1, 50000, 50000, "Pemilik", 0, "Dokter A"]);
  let total = 0; sheet.eachRow((row, nomor) => { if (nomor > 1) total += Number(row.getCell(10).value); });
  expect(total).toBe(59000);
  const ring = book.getWorksheet("Ringkasan per kategori")!;
  expect(ring).toBeDefined();
  const nilai: unknown[][] = []; ring.eachRow(row => nilai.push((row.values as unknown[]).slice(1)));
  expect(nilai[0]).toEqual(["Kategori", "Sub kategori", "Baris", "Kuantitas", "Total Harga"]);
  expect(nilai.at(-1)).toEqual(["Jumlah semua kategori", "", 2, 3, 59000]);
});

it("CSV/Excel lengkap yang lama membawa kolom Kode, Kategori, Sub kategori dan angka tidak berubah", async () => {
  const response = await GET(new Request(`https://example.test/laporan/penjualan-barang/unduh?${params}&format=csv`));
  const teks = await response.text();
  const kepala = teks.split("\n")[0];
  expect(kepala).toContain("Kode");
  expect(kepala).toContain("Kategori");
  expect(kepala).toContain("Sub kategori");
  expect(teks).toContain("59000");
  const xlsx = await GET(new Request(`https://example.test/laporan/penjualan-barang/unduh?${params}&format=xlsx`));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await xlsx.arrayBuffer());
  const kolom = (book.getWorksheet("Penjualan barang")!.getRow(1).values as string[]).slice(1);
  expect(kolom.slice(7, 11)).toEqual(["Barang / layanan", "Kode", "Kategori", "Sub kategori"]);
  expect(book.getWorksheet("Penjualan barang")!.rowCount).toBe(4);
});

it("unduhan Accurate memakai gerbang akses yang sama: tanpa sesi 401, tanpa modul 403, tidak membaca data", async () => {
  mocks.createClient.mockResolvedValue(clientFixture({ anonymous: true }).client);
  expect((await GET(new Request(`https://example.test/unduh?${params}&format=accurate`))).status).toBe(401);
  mocks.createClient.mockResolvedValue(clientFixture({ role: "KASIR", modules: [{ role: "KASIR", module_id: "pos" }] }).client);
  expect((await GET(new Request(`https://example.test/unduh?${params}&format=accurate`))).status).toBe(403);
  expect(mocks.load).not.toHaveBeenCalled();
});

it("kategori yang tidak dikenal pada alamat tidak merusak laporan dan hasilnya kosong yang jujur", async () => {
  mocks.load.mockResolvedValue(hasil({ rows: [], nilaiTotal: 0, qtyTotal: 0, ringkasan: ringkasKategori([]) }));
  const html = await halaman({ kategori: "ZZZ" });
  expect(html).toContain("Belum ada penjualan untuk pilihan ini");
  expect(html).toContain('<option value="ZZZ" selected="">ZZZ</option>');
});
