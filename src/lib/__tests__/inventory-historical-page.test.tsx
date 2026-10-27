import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";

const fixture = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fixture.client }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock("@/components/SearchableMultiSelect", () => ({ SearchableMultiSelect: ({ value }: { value: string[] }) => <span>Cabang dipilih: {value.join(",")}</span> }));
vi.mock("@/components/ReportPresets", () => ({ ReportPresets: ({ title }: { title: string }) => <span>Konfigurasi tersimpan: {title}</span> }));
import Page from "@/app/(app)/laporan/nilai-persediaan/historis/page";

it("renders saved-event details and reconciles branch subtotal to complete detail", async () => {
  fixture.client = clientFixture({ tables: {
    inventory_costing_settings: [{ id: true, method: "moving_average", activated_at: "2026-10-22T03:00:00Z" }],
    warehouses: [{ id: "w1", branch_id: "b1", name: "Gudang A", code: "A" }],
    inventory_cost_events: [{ id: 1, warehouse_id: "w1", item_id: "i", tanggal: "2026-10-22", source: "average-activation", source_ref: null, qty_delta: "2", value_delta: "20.125", qty_after: "2", value_after: "20.125", average_after: "10.0625" }],
    coa_accounts: [{ id: "a1301", code: "1301" }],
    journal_lines: [
      { id: "l1", account_id: "a1301", debit: "20", credit: "0", journal_entries: { tanggal: "2026-10-22", branch_id: "b1" } },
      { id: "l2", account_id: "a1301", debit: "5", credit: "0", journal_entries: { tanggal: "2026-10-22", branch_id: null } },
    ],
  } }).client;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ tanggal: "2026-10-22", cabang: ["b1"] }) }));
  expect(html).toContain("Cabang dipilih: b1");
  expect(html).toContain("Konfigurasi tersimpan: Valuasi as-of");
  expect(html).toContain("Rp 20,125");
  expect(html).toContain("RINCIAN EVENT TERAKHIR");
  expect(html).toContain("gudang–cabang saat laporan dibaca");
  expect(html).toContain("GL 1301 as-of");
  expect(html).toContain("Rp 0,125");
  expect(html).toContain("belum membuktikan rekonsiliasi historis cabang");
  expect(html).toContain("akun=1301&amp;sampai=2026-10-22&amp;cabang=b1");
  const allHtml = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ tanggal: "2026-10-22" }) }));
  expect(allHtml).toContain("Jurnal 1301 tanpa cabang: Rp 5");
});

it("explains unavailable FIFO history without presenting a fabricated total", async () => {
  fixture.client = clientFixture({ tables: { inventory_costing_settings: [{ id: true, method: "fifo", activated_at: null }] } }).client;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ tanggal: "2026-10-22" }) }));
  expect(html).toContain("belum tersedia");
  expect(html).not.toContain("Total cabang terpilih");
});

it("keeps the cutoff and every selected branch in paging and per-branch ledger links", async () => {
  const items = Array.from({ length: 120 }, (_, index) => ({ id: `i${String(index).padStart(3, "0")}`, code: `K${index}`, name: `Barang ${String(index).padStart(3, "0")}`, unit: "PCS" }));
  const seed = (warehouse: string, item: string) => ({ id: `${warehouse}-${item}`, warehouse_id: warehouse, item_id: item, tanggal: "2026-10-22", source: "average-activation", source_ref: null, qty_delta: "1", value_delta: "2", qty_after: "1", value_after: "2", average_after: "2" });
  fixture.client = clientFixture({ tables: {
    inventory_costing_settings: [{ id: true, method: "moving_average", activated_at: "2026-10-22T03:00:00Z" }],
    warehouses: [{ id: "w1", branch_id: "b1", name: "Gudang Satu", code: "G1" }, { id: "w2", branch_id: "b2", name: "Gudang Dua", code: "G2" }],
    inventory_cost_events: [
      ...items.slice(0, 60).map(item => seed("w1", item.id)),
      ...items.slice(60).map(item => seed("w2", item.id)),
      { id: "late", warehouse_id: "w1", item_id: "i000", tanggal: "2026-10-24", source: "pos", source_ref: "LATE", qty_delta: "1", value_delta: "2", qty_after: "2", value_after: "4", average_after: "2" },
    ],
    items,
    coa_accounts: [{ id: "a1301", code: "1301" }],
    journal_lines: [
      { id: "l1", account_id: "a1301", debit: "100", credit: "0", journal_entries: { tanggal: "2026-10-22", branch_id: "b1" } },
      { id: "l2", account_id: "a1301", debit: "120", credit: "0", journal_entries: { tanggal: "2026-10-22", branch_id: "b2" } },
      { id: "l3", account_id: "a1301", debit: "7", credit: "0", journal_entries: { tanggal: "2026-10-22", branch_id: null } },
      { id: "l4", account_id: "a1301", debit: "999", credit: "0", journal_entries: { tanggal: "2026-10-23", branch_id: "b1" } },
    ],
  } }).client;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ tanggal: "2026-10-22", cabang: ["b1", "b2"], halaman: "2" }) }));
  expect(html).toContain("Halaman 2 dari 2 · 120 baris");
  expect(html).toContain("tanggal=2026-10-22&amp;halaman=1&amp;cabang=b1&amp;cabang=b2");
  expect(html).toContain("akun=1301&amp;sampai=2026-10-22&amp;cabang=b1");
  expect(html).toContain("akun=1301&amp;sampai=2026-10-22&amp;cabang=b2");
  // Event and GL cutoffs match: later moves and journals stay out of the 2026-10-22 position.
  expect(html).not.toContain("Rp 242");
  expect(html).not.toContain("Rp 1.219");
  expect(html).toContain("Rp 240");
  expect(html).toContain("Rp 220");
  expect(html).toContain("Jurnal 1301 tanpa cabang: Rp 7");
});

it("R04: shows a minus position valued at the last known average with a visible estimate flag", async () => {
  fixture.client = clientFixture({ tables: {
    inventory_costing_settings: [{ id: true, method: "moving_average", activated_at: "2026-10-22T03:00:00Z" }],
    warehouses: [{ id: "w1", branch_id: "b1", name: "Gudang A", code: "A" }],
    inventory_cost_events: [
      { id: 1, warehouse_id: "w1", item_id: "i", tanggal: "2026-10-22", source: "average-activation", source_ref: null, qty_delta: "1", value_delta: "10", qty_after: "1", value_after: "10", average_after: "10" },
      { id: 2, warehouse_id: "w1", item_id: "i", tanggal: "2026-10-22", source: "sale", source_ref: "SALE-1", qty_delta: "-4", value_delta: null, qty_after: "-3", value_after: null, average_after: null },
    ],
    items: [{ id: "i", code: "K1", name: "Barang minus fiktif", unit: "PCS" }],
    coa_accounts: [{ id: "a1301", code: "1301" }],
    journal_lines: [],
  } }).client;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ tanggal: "2026-10-22", cabang: ["b1"] }) }));
  expect(html).toContain("Rp -30 · taksiran HPP terakhir Rp 10");
  expect(html).toContain("Nilai minus taksiran");
  // Summary column is a rupiah amount (per branch and total), not a bare row count.
  expect(html.match(/<td>Rp -30 \(1 baris\)<\/td>/g)).toHaveLength(2);
  expect(html).toContain("Kebijakan stok minus (R04)");
  expect(html).not.toContain("Belum tersedia</td><td>Rp 0");
});
