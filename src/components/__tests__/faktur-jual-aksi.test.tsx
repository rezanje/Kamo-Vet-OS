import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ boleh: true, status: "berjalan" }));
vi.mock("next/link", () => ({ default: ({ children, ...p }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...p}>{children}</a> }));
vi.mock("@/components/MasterPage", () => ({ MasterPage: ({ children }: React.PropsWithChildren) => <main>{children}</main> }));
vi.mock("@/components/PilihRekening", () => ({ loadRekeningAktif: async () => [], PilihRekening: () => null }));
vi.mock("@/lib/master-guard", () => ({ bolehTransaksiKas: async () => state.boleh }));
vi.mock("@/lib/sales-channel-trace", () => ({ loadSalesChannelTrace: async () => ({ rows: [], count: 0, pageInfo: { page: 1, pages: 1, size: 20 } }) }));
vi.mock("@/lib/sales-invoice-payments-server", () => ({ loadSalesInvoicePayments: async () => ({ receipts: new Map(), payments: new Map() }) }));
vi.mock("@/app/(app)/penjualan/faktur/actions", () => ({ terimaPembayaranJual: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, is: () => query, gt: () => query, in: () => query,
      order: () => query, range: () => query,
      then: (resolve: (value: unknown) => unknown) => {
        const rows = table === "sales_invoices"
          ? [{ id: "inv-1", no_faktur: "FJ.2026.10.00001", tanggal: "2026-10-20", jatuh_tempo: "2026-11-19",
              dpp: 2000000, ppn: 0, total: 2000000, carried_paid: 0, status: state.status, customer_id: "cust",
              kategori: null, catatan: null, opening_batch_id: null, customers: { name: "Toko Hewan" }, sales_orders: { no_pesanan: "SO.1" } }]
          : [];
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve);
      },
    };
    return query;
  },
}) }));

import Page from "@/app/(app)/penjualan/faktur/page";
const render = async () => renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

beforeEach(() => { state.boleh = true; state.status = "berjalan"; });

it("daftar faktur punya kolom Aksi dengan tombol Edit ke rincian fakturnya", async () => {
  const html = await render();
  expect(html).toContain("<th style=\"width:90px\">Aksi</th>");
  expect(html).toContain('href="/penjualan/faktur/inv-1"');
  expect(html).toContain("Edit");
});

it("faktur yang sudah batal hanya bisa dilihat, bukan diedit", async () => {
  state.status = "batal";
  const html = await render();
  const baris = html.slice(html.indexOf("FJ.2026.10.00001"));
  expect(baris.slice(0, baris.indexOf("</tr>"))).toContain("Lihat");
});

it("menyediakan tombol Faktur Penjualan baru untuk peran yang berhak", async () => {
  expect(await render()).toContain('href="/penjualan/faktur/baru"');
});

it("menyembunyikan tombol faktur baru dari peran yang tidak berhak", async () => {
  state.boleh = false;
  const html = await render();
  expect(html).not.toContain('href="/penjualan/faktur/baru"');
  expect(html).toContain("Aksi");
});
