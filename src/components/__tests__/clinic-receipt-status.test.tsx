import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => null }));
vi.mock("@/app/(app)/klinik/stok/StokTabs", () => ({ StokTabs: () => null, StatCard: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from: () => {
    const query = { select: () => query, eq: () => query, in: () => query, order: () => query, limit: () => query,
      single: async () => ({ data: { role: "OWNER" } }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [] }).then(resolve) };
    return query;
  },
}) }));
import KlinikPenerimaanPage from "@/app/(app)/klinik/penerimaan/page";

it("shows a confirmed clinic receipt and its actual signed quantity difference", async () => {
  const html = renderToStaticMarkup(await KlinikPenerimaanPage({ searchParams: Promise.resolve({ success: "terima", trm: "TRM-11", selisih: "-2" }) }));
  expect(html).toContain('role="status"'); expect(html).toContain("TRM-11"); expect(html).toContain("Selisih: -2");
});
it("shows failure without a success banner when saving is rejected", async () => {
  const html = renderToStaticMarkup(await KlinikPenerimaanPage({ searchParams: Promise.resolve({ error: "Stok kurang", success: "terima" }) }));
  expect(html).toContain('role="alert"'); expect(html).toContain("Stok kurang"); expect(html).not.toContain("stok diperbarui");
});
it.each([{}, { success: "unknown" }])("does not claim receipt success without its confirmed result %j", async params => {
  const html = renderToStaticMarkup(await KlinikPenerimaanPage({ searchParams: Promise.resolve(params) }));
  expect(html).not.toContain('role="status"'); expect(html).not.toContain('role="alert"');
});
