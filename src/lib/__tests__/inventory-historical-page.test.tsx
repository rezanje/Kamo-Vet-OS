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
