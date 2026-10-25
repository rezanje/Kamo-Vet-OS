import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ failPending: false, extraPending: 0 }));
const invoiceId = "11111111-1111-4111-8111-111111111111";
const pending = {
  id: "pending-request", jenis: "bayar-faktur", ref_id: invoiceId,
  no_dokumen: "FB-OLDER", nilai: 100_000, keterangan: "Pembayaran FB-OLDER",
  penyetuju_role: "OWNER", status: "menunggu", diajukan_oleh: "actor",
  diajukan_at: "2026-01-01T00:00:00Z", diputus_at: null, catatan: null,
};
const decisions = Array.from({ length: 60 }, (_, index) => ({
  ...pending, id: `decided-${index}`, status: "terpakai",
  diajukan_at: new Date(Date.UTC(2026, 0, 2, 0, index)).toISOString(),
}));

vi.mock("next/link", () => ({ default: ({ children, prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a {...props} data-prefetch={prefetch ? "true" : undefined}>{children}</a> }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Error(`redirect:${path}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    const filters: { status?: string; excludedStatus?: string } = {};
    let first = 0;
    let last = 1000;
    const query = {
      select: () => query,
      eq: (field: string, value: string) => { if (field === "status") filters.status = value; return query; },
      neq: (field: string, value: string) => { if (field === "status") filters.excludedStatus = value; return query; },
      order: () => query,
      range: (from: number, to: number) => { first = from; last = to; return query; },
      limit: (size: number) => { last = size - 1; return query; },
      maybeSingle: async () => ({ data: { role: "OWNER" }, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        if (table !== "approval_requests") return Promise.resolve({ data: [], error: null }).then(resolve);
        if (state.failPending && filters.status === "menunggu") return Promise.resolve({ data: null, count: null, error: { message: "read failed" } }).then(resolve);
        const morePending = Array.from({ length: state.extraPending }, (_, index) => ({ ...pending, id: `pending-${index}` }));
        const rows = [...decisions, ...morePending, pending].filter(row =>
          (!filters.status || row.status === filters.status) &&
          (!filters.excludedStatus || row.status !== filters.excludedStatus));
        return Promise.resolve({ data: rows.slice(first, last + 1), count: rows.length, error: null }).then(resolve);
      },
    };
    return query;
  },
}) }));

import PenyetujuPage from "@/app/(app)/pengaturan/penyetuju/page";

beforeEach(() => { state.failPending = false; state.extraPending = 0; });

it("keeps an older pending invoice actionable after 60 newer decisions", async () => {
  const html = renderToStaticMarkup(await PenyetujuPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("MENUNGGU PERSETUJUAN (1)");
  expect(html).toContain("FB-OLDER");
  expect(html).toContain(`href="/pembelian/faktur/${invoiceId}"`);
  expect(html).toContain("Setujui");
});

it("shows a load failure instead of an empty pending queue", async () => {
  state.failPending = true;
  const html = renderToStaticMarkup(await PenyetujuPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("belum dapat dimuat lengkap");
  expect(html).not.toContain("Tidak ada transaksi yang menunggu persetujuan.");
});

it("keeps pending requests past the first 50 on a second page", async () => {
  state.extraPending = 50;
  const html = renderToStaticMarkup(await PenyetujuPage({ searchParams: Promise.resolve({ hal: "2" }) }));
  expect(html).toContain("MENUNGGU PERSETUJUAN (51)");
  expect(html).toContain('value="pending-request"');
  expect(html).toContain("Halaman 2/2");
});
