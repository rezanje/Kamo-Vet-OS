import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";
const fixture = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fixture.client }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
import ClosingPage from "@/app/(app)/keuangan/closing-hpp/page";

it("shows method activation and disables global changes without every branch", async () => {
  fixture.client = clientFixture({ deniedBranch: "b2" }).client;
  const html = renderToStaticMarkup(await ClosingPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("Aktifkan rata-rata bergerak");
  expect(html).toContain("memerlukan akses seluruh cabang");
  expect(html).toContain('disabled=""');
  expect(html).toContain("Belum ada snapshot");
});

it("surfaces a snapshot read error without rendering mutation forms", async () => {
  fixture.client = clientFixture({ errorTable: "inventory_month_closes" }).client;
  const html = renderToStaticMarkup(await ClosingPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("belum bisa dibaca lengkap");
  expect(html).not.toContain("Aktifkan rata-rata bergerak");
});

it('shows branch subtotals from the selected historical snapshot and preserves filters in paging', async () => {
 const values = Array.from({length: 101},(_,index) => ({close_id:'c1',warehouse_id:'w1',item_id:'i'+index,qty:1,average_cost:2,value:2}));
 fixture.client = clientFixture({ tables: {
  warehouses:[{id:'w1',branch_id:'b1',name:'Historis'}],
  inventory_month_closes:[{id:'c1',period:'2026-09-01',closed_through:'2026-09-30',closed_at:'2026-10-01T00:00:00Z'}],
  inventory_month_values:values,
  items:values.map(v => ({id:v.item_id,code:v.item_id,name:'Obat lama',unit:'ml'})),
 }}).client;
 const html = renderToStaticMarkup(await ClosingPage({searchParams:Promise.resolve({snapshot:'c1',cabang:['b1']})}));
 expect(html).toContain('RINGKASAN PER CABANG'); expect(html).toContain('Rp 202,00');
 expect(html).toContain('name="cabang" value="b1"');
 expect(html).toContain('snapshot=c1&amp;cabang=b1&amp;halaman=2');
 expect(html).toContain('tanggal lain');
});

it('shows per-branch ledger comparison, source links, and separately flags unallocated GL', async () => {
 fixture.client = clientFixture({tables:{
  inventory_month_closes:[{id:'c1',period:'2026-09-01',closed_through:'2026-09-30',closed_at:'2026-10-01T00:00:00Z'}],
  inventory_month_values:[{close_id:'c1',warehouse_id:'w1',item_id:'i',qty:2,average_cost:80,value:160}],
  coa_accounts:[{id:'a1301',code:'1301'}],
  journal_lines:[
   {id:'j1',account_id:'a1301',debit:'150',credit:'0',journal_entries:{tanggal:'2026-09-30',branch_id:'b1'}},
   {id:'j2',account_id:'a1301',debit:'5',credit:'0',journal_entries:{tanggal:'2026-09-30',branch_id:null}},
  ],
 }}).client;
 const html = renderToStaticMarkup(await ClosingPage({searchParams:Promise.resolve({snapshot:'c1'})}));
 expect(html).toContain('GL 1301 as-of');
 expect(html).toContain('Rp 150,00');
 expect(html).toContain('Rp 10,00');
 expect(html).toContain('/keuangan/buku-besar?akun=1301&amp;sampai=2026-09-30&amp;cabang=b1');
 expect(html).toContain('Jurnal 1301 tanpa cabang');
 expect(html).toContain('tidak termasuk total GL cabang');
});
