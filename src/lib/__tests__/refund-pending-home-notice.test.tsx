import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "FINANCE", pending: false, rpcCalls: [] as { name: string; args: unknown }[] }));
vi.mock("next/link", () => ({ default: ({ children, prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a {...props} data-prefetch={prefetch ? "true" : undefined}>{children}</a> }));
vi.mock("@/lib/ledger", () => ({ getAccountBalances: async () => [] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, order: () => query,
      maybeSingle: async () => ({ data: table === "profiles" ? { role: state.role, is_active: true } : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
    return query;
  },
  rpc: async (name: string, args: unknown) => {
    state.rpcCalls.push({ name, args });
    return { data: state.pending ? [{ id: "pending-refund" }] : [], error: null };
  },
}) }));

import KasBankPage from "@/app/(app)/kas-bank/page";

beforeEach(() => { state.role = "FINANCE"; state.pending = false; state.rpcCalls = []; });

it("shows an authorized finance user that a transfer refund is waiting", async () => {
  state.pending = true;
  const html = renderToStaticMarkup(await KasBankPage());
  expect(html).toContain('href="/kas-bank/refund"');
  expect(html).toContain("Ada refund transfer menunggu");
  expect(state.rpcCalls).toContainEqual({ name: "get_sales_refund_requests", args: { p_sale_id: null, p_office: true, p_status: "pending", p_offset: 0 } });
  state.pending = false;
  expect(renderToStaticMarkup(await KasBankPage())).not.toContain("Ada refund transfer menunggu");
});

it("keeps the refund queue entry out of a cashier's module home", async () => {
  state.role = "STAFF";
  const html = renderToStaticMarkup(await KasBankPage());
  expect(html).not.toContain('href="/kas-bank/refund"');
  expect(html).not.toContain("Ada refund transfer menunggu");
  expect(state.rpcCalls).toEqual([]);
});
