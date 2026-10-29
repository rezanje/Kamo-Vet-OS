import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { BarisFaktur } from "@/lib/faktur-gabungan";

const state = vi.hoisted(() => ({ boleh: true, rows: [] as unknown[] }));

vi.mock("next/link", () => ({ default: ({ children, ...p }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...p}>{children}</a> }));
vi.mock("@/components/MasterPage", () => ({ MasterPage: ({ children }: React.PropsWithChildren) => <main>{children}</main> }));
vi.mock("@/components/PilihRekening", () => ({ loadRekeningAktif: async () => [], PilihRekening: () => null }));
vi.mock("@/lib/master-guard", () => ({ bolehTransaksiKas: async () => state.boleh }));
vi.mock("@/app/(app)/penjualan/faktur/actions", () => ({ terimaPembayaranJual: vi.fn() }));
vi.mock("@/lib/faktur-gabungan-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/faktur-gabungan-server")>()),
  bacaFakturGabungan: async () => ({
    rows: state.rows,
    ringkasan: { jumlah: state.rows.length, total: 4_600_000, jumlahBelum: 1, totalBelum: 4_500_000 },
    pageInfo: { page: 1, from: 0, to: 49, totalPages: 1 },
    cabangOptions: [{ id: "b1", name: "Pondok Aren" }],
    pelangganTerpotong: false,
  }),
  muatSisaGrosir: async () => new Map([["inv-1", 4_500_000]]),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: () => {
    const query = {
      select: () => query, eq: () => query, is: () => query, gt: () => query, in: () => query,
      order: () => query, range: () => query,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
    };
    return query;
  },
}) }));

import Page from "@/app/(app)/penjualan/faktur/page";

const baris = (over: Partial<BarisFaktur> & Pick<BarisFaktur, "id" | "sumber">): BarisFaktur => ({
  nomor: "X", tanggal: "2026-10-20", total: 100_000, status: "lunas", branchId: "b1",
  customerId: null, namaBebas: null, cabang: "Pondok Aren", pelanggan: "Umum",
  keterangan: "", visitId: null, rincianHpp: true, ...over,
});

const render = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  state.boleh = true;
  state.rows = [
    baris({ id: "inv-1", sumber: "grosir", nomor: "FJ.2026.10.00001", status: "belum", total: 4_500_000, pelanggan: "Toko Hewan" }),
    baris({ id: "sale-1", sumber: "petshop", nomor: "CMGG2026102908220", keterangan: "Kasir petshop" }),
    baris({ id: "ci-1", sumber: "klinik", nomor: "INV-9", visitId: "visit-7", pelanggan: "Siti" }),
  ];
});

it("menampilkan ketiga sumber penjualan dalam satu tabel", async () => {
  const html = await render();
  for (const nomor of ["FJ.2026.10.00001", "CMGG2026102908220", "INV-9"]) expect(html).toContain(nomor);
  for (const label of ["Petshop", "Klinik", "Grosir"]) expect(html).toContain(`>${label}</span>`);
  for (const kolom of ["Nomor", "Tanggal", "Cabang", "Sumber", "Pelanggan", "Keterangan", "Status", "Umur", "Total", "Aksi"]) {
    expect(html).toContain(`>${kolom}</th>`);
  }
});

it("tiap baris mengantar ke dokumen aslinya", async () => {
  const html = await render();
  expect(html).toContain('href="/penjualan/faktur/inv-1"');
  expect(html).toContain('href="/penjualan/sale-1"');
  expect(html).toContain('href="/klinik/pembayaran/visit-7"');
});

it("hanya baris grosir yang bisa diedit; sumber lain cukup dilihat", async () => {
  const html = await render();
  const potong = (nomor: string) => {
    const mulai = html.indexOf(nomor);
    return html.slice(mulai, html.indexOf("</tr>", mulai));
  };
  expect(potong("FJ.2026.10.00001")).toContain("Edit");
  expect(potong("CMGG2026102908220")).toContain("Lihat");
  expect(potong("INV-9")).toContain("Lihat");
});

it("form Penerimaan hanya muncul pada baris grosir", async () => {
  const html = await render();
  expect(html).toContain("Terima / periksa");
  expect(html.match(/Terima \/ periksa/g)).toHaveLength(1);
  expect(html).toContain("Rp 4.500.000");
});

it("kaki daftar memuat jumlah dokumen dan total seluruh saringan", async () => {
  const html = await render();
  expect(html).toContain("Total 3 dokumen sesuai saringan");
  expect(html).toContain("Rp 4.600.000");
});

it("menyediakan filter, pencarian, dan unduhan", async () => {
  const html = await render({ dari: "2026-10-01", sampai: "2026-10-31", sumber: "grosir" });
  for (const nama of ["dari", "sampai", "cabang", "sumber", "status", "pelanggan", "cari", "batal"]) {
    expect(html).toContain(`name="${nama}"`);
  }
  expect(html).toContain("format=xlsx");
  expect(html).toContain("format=csv");
  expect(html).toContain("sumber=grosir");
});

it("menyediakan tombol Faktur Penjualan baru untuk peran yang berhak", async () => {
  expect(await render()).toContain('href="/penjualan/faktur/baru"');
});

it("menyembunyikan tombol faktur baru dan kolom Terima dari peran yang tidak berhak", async () => {
  state.boleh = false;
  const html = await render();
  expect(html).not.toContain('href="/penjualan/faktur/baru"');
  expect(html).not.toContain("Terima / periksa");
  expect(html).toContain("Aksi");
});

it("faktur grosir yang batal hanya bisa dilihat", async () => {
  state.rows = [baris({ id: "inv-9", sumber: "grosir", nomor: "FJ.2026.10.00009", status: "batal" })];
  const html = await render();
  const mulai = html.indexOf("FJ.2026.10.00009");
  expect(html.slice(mulai, html.indexOf("</tr>", mulai))).toContain("Lihat");
  expect(html).toContain("Dibatalkan");
});
