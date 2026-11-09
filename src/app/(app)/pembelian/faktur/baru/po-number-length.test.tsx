import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Nomor PO memuat kode cabang: PO-YYYYMMDD-<kode>-NNNN = 25 karakter untuk kode 8 huruf (VET_CMGG), 30 untuk batas fungsi.
// Kolom pencarian "nomor PO tepat" tidak boleh memotong nomor itu (dulu 24 karakter, jadi PO cabang 8 huruf tak pernah ketemu).
const state = vi.hoisted(() => ({ poEquals: [] as string[] }));

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/app/(app)/pembelian/faktur/baru/FakturForm", () => ({ FakturForm: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    const query = {
      select: () => query,
      eq: (column: string, value: string) => { if (table === "purchase_orders" && column === "no_po") state.poEquals.push(value); return query; },
      in: () => query, is: () => query, not: () => query, order: () => query, limit: () => query, range: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
    };
    return query;
  },
}) }));

import FakturBaruPage from "@/app/(app)/pembelian/faktur/baru/page";

beforeEach(() => { state.poEquals = []; });

it("searches the exact PO number without cutting a 25-character branch-coded number", async () => {
  const no = "PO-20261109-VET_CMGG-0001";
  expect(no).toHaveLength(25);
  const html = renderToStaticMarkup(await FakturBaruPage({ searchParams: Promise.resolve({ po_no: no }) }));
  expect(state.poEquals).toEqual([no]);
  expect(html).toContain(`value="${no}"`);
});

it("keeps the longest allowed PO number (30 characters) whole and lets the field hold it", async () => {
  const no = "PO-20261109-ABCDEFGHIJKLM-0001";
  expect(no).toHaveLength(30);
  const html = renderToStaticMarkup(await FakturBaruPage({ searchParams: Promise.resolve({ po_no: no }) }));
  expect(state.poEquals).toEqual([no]);
  expect(html).toMatch(/name="po_no"[^>]*maxLength="64"|maxLength="64"[^>]*name="po_no"/);
});
