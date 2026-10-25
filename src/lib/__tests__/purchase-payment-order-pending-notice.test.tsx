import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ canApprove: true, pendingCount: 0, countQueries: 0 }));
vi.mock("next/link", () => ({ default: ({ children, prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a {...props} data-prefetch={prefetch ? "true" : undefined}>{children}</a> }));
vi.mock("@/lib/master-guard", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/master-guard")>(), bolehKelolaMaster: async () => state.canApprove }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    const query = { select: (_fields: string, options?: { head?: boolean }) => { if (table === "payment_orders" && options?.head) state.countQueries++; return query; }, eq: () => query, order: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], count: table === "payment_orders" ? state.pendingCount : null, error: null }).then(resolve) };
    return query;
  },
}) }));

import PembelianPage from "@/app/(app)/pembelian/page";

beforeEach(() => { state.canApprove = true; state.pendingCount = 0; state.countQueries = 0; });

async function render() {
  return renderToStaticMarkup(await PembelianPage({ searchParams: Promise.resolve({}) }));
}

it("alerts an approving role to saved draft payment orders", async () => {
  state.pendingCount = 2;
  const html = await render();
  expect(html).toContain("2 perintah pembayaran menunggu persetujuan");
  expect(html).toContain('href="/pembelian/perintah-bayar?pending=1"');
  expect(state.countQueries).toBe(1);
  state.pendingCount = 0;
  expect(await render()).not.toContain("menunggu persetujuan");
});

it("does not query approval counts for a role without approval rights", async () => {
  state.canApprove = false;
  state.pendingCount = 2;
  expect(await render()).not.toContain("menunggu persetujuan");
  expect(state.countQueries).toBe(0);
});
