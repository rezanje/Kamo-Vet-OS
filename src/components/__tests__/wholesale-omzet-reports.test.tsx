// @vitest-environment jsdom
// Faktur Penjualan grosir harus terlihat di laporan omzet lintas kanal — keluhan
// Pak Andri 29 Okt 2026: faktur yang sudah diinput tidak muncul di laporan omset.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ fakturs: [] as Record<string, unknown>[] }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock("@/components/LaporanPage", () => ({
  LaporanPage: ({ filter, ringkasan, children }: { filter: React.ReactNode; ringkasan: React.ReactNode; children: React.ReactNode }) =>
    <main>{filter}{ringkasan}{children}</main>,
  KartuAngka: ({ items }: { items: { label: string; nilai: string }[] }) =>
    <div>{items.map(i => <div key={i.label}>{i.label}: {i.nilai}</div>)}</div>,
  TabelKosong: () => null,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from(table: string) {
    const data = () => table === "sales_invoices" ? fixture.fakturs
      : table === "branches" ? [{ id: "dc", name: "DC" }, { id: "pdry", name: "Panduraya" }] : [];
    const result = () => ({ data: data(), error: null, count: data().length });
    const q = { select: () => q, eq: () => q, is: () => q, in: () => q, not: () => q, order: () => q,
      limit: () => q, gt: () => q, gte: () => q, lte: () => q, ilike: () => q,
      range: async () => result(), maybeSingle: async () => ({ data: data()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return q;
  },
}) }));

import PenjualanRinciPage from "@/app/(app)/laporan/penjualan-rinci/page";
import TransaksiCabangPage from "@/app/(app)/laporan/transaksi-cabang/page";

const faktur = (over: Record<string, unknown> = {}) => ({
  id: "fj4", no_faktur: "FJ.2026.10.00004", branch_id: "dc", customer_id: "reseller",
  tanggal: "2026-10-29", dpp: 1_050_000, ppn: 0, total: 1_050_000, status: "lunas",
  kategori: "umum", voided_on: null, opening_batch_id: null, replaces_invoice_id: null,
  branches: { name: "DC" }, customers: { name: "Reseller A" },
  sales_invoice_items: [{ id: "l1" }], ...over,
});
const rentang = { dari: "2026-10-29", sampai: "2026-10-29" };

beforeEach(() => { fixture.fakturs = [faktur()]; });

it("menampilkan faktur grosir di rincian penjualan per transaksi beserta kartu kanalnya", async () => {
  const html = renderToStaticMarkup(await PenjualanRinciPage({ searchParams: Promise.resolve(rentang) }));
  expect(html).toContain("FJ.2026.10.00004");
  expect(html).toContain("/penjualan/faktur/fj4");
  expect(html).toContain("Grosir (Faktur Penjualan)");
  expect(html).toContain("Reseller A");
  // Kartu ringkasan dan tabel sama-sama memakai angka bersih faktur.
  expect(html).toContain("Grosir (Faktur Penjualan): Rp 1.050.000");
});

it("menandai faktur yang belum dibayar sebagai omzet berjalan, bukan menyembunyikannya", async () => {
  fixture.fakturs = [faktur({ status: "berjalan", total: 15_000, no_faktur: "FJ.2026.10.00002" })];
  const html = renderToStaticMarkup(await PenjualanRinciPage({ searchParams: Promise.resolve(rentang) }));
  expect(html).toContain("FJ.2026.10.00002");
  expect(html).toContain("Belum lunas");
  expect(html).toContain("Grosir (Faktur Penjualan): Rp 15.000");
});

it("menyembunyikan faktur grosir yang batal, diganti koreksi, saldo awal, atau selisih stok opname", async () => {
  fixture.fakturs = [
    faktur({ id: "batal", no_faktur: "FJ-BATAL", status: "batal", voided_on: "2026-10-29" }),
    faktur({ id: "lama", no_faktur: "FJ-LAMA" }),
    faktur({ id: "baru", no_faktur: "FJ-BARU", replaces_invoice_id: "lama", total: 350_000 }),
    faktur({ id: "saldo", no_faktur: "FJ-SALDO", opening_batch_id: "b" }),
    faktur({ id: "opname", no_faktur: "FJS-OPNAME", kategori: "selisih_stok", total: 7_586_000 }),
  ];
  const html = renderToStaticMarkup(await PenjualanRinciPage({ searchParams: Promise.resolve(rentang) }));
  expect(html).toContain("FJ-BARU");
  for (const hilang of ["FJ-BATAL", "FJ-LAMA", "FJ-SALDO", "FJS-OPNAME"]) expect(html).not.toContain(hilang);
  expect(html).toContain("Grosir (Faktur Penjualan): Rp 350.000");
});

it("memasukkan omzet grosir ke laporan transaksi per cabang pada cabang fakturnya", async () => {
  fixture.fakturs = [
    faktur({ id: "a", total: 1_050_000 }),
    faktur({ id: "b", branch_id: "pdry", branches: { name: "Panduraya" }, total: 14_000 }),
  ];
  const html = renderToStaticMarkup(await TransaksiCabangPage({ searchParams: Promise.resolve(rentang) }));
  expect(html).toContain("POS / Online / Klinik / Grosir");
  expect(html).toContain("0 / 0 / 0 / 1");
  expect(html).toContain("Rp 1.050.000");
  expect(html).toContain("Rp 14.000");
  expect(html).toContain("Rp 1.064.000");
});

it("menyaring laporan per cabang ke satu cabang grosir saja ketika cabangnya dipilih", async () => {
  fixture.fakturs = [
    faktur({ id: "a", total: 1_050_000 }),
    faktur({ id: "b", branch_id: "pdry", branches: { name: "Panduraya" }, total: 14_000 }),
  ];
  const html = renderToStaticMarkup(await TransaksiCabangPage({ searchParams: Promise.resolve({ ...rentang, cabang_id: "pdry" }) }));
  expect(html).toContain("Rp 14.000");
  expect(html).not.toContain("Rp 1.050.000");
});

it("menyaring laporan per cabang ke kanal grosir saja ketika pintu transaksinya dipilih", async () => {
  const html = renderToStaticMarkup(await TransaksiCabangPage({ searchParams: Promise.resolve({ ...rentang, kanal: "Grosir" }) }));
  expect(html).toContain("Rp 1.050.000");
  expect(html).toContain("0 / 0 / 0 / 1");
});
