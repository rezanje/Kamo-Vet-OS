import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ role: "OWNER", active: true }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift", branch_id: "branch" }) }));
vi.mock("@/app/(app)/klinik/stok/StokTabs", () => ({ StokTabs: () => null, StatCard: () => null }));
vi.mock("@/app/(app)/klinik/pengeluaran/TambahPengeluaran", () => ({ TambahPengeluaran: () => null }));
vi.mock("@/app/(app)/penjualan/online/actions", () => ({ tandaiCair: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    const data = table === "profiles" ? { role: fixture.role, is_active: fixture.active }
      : table === "expenses" ? [{ id: "expense", tanggal: "2026-10-21", created_at: "2026-10-21T03:00:00Z", kategori: "Operasional", deskripsi: "Bukti klinik", jumlah: 0, metode_bayar: "Tunai", voided_at: "2026-10-21T04:00:00Z" }]
        : [{ id: "sale", no_struk: "WA-001", created_at: "2026-10-21T03:00:00Z", channel: "WA", total: 100, komisi: 0, marketplace_status: "lunas" }];
    const query = { select: () => query, eq: () => query, gte: () => query, lte: () => query, ilike: () => query, order: () => query, limit: () => query, not: () => query, is: () => query,
      single: async () => ({ data }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data }).then(resolve) };
    return query;
  },
}) }));
import KlinikPengeluaranPage from "@/app/(app)/klinik/pengeluaran/page";
import PenjualanOnlinePage from "@/app/(app)/penjualan/online/page";

beforeEach(() => { fixture.role = "OWNER"; fixture.active = true; });
it("opens the existing expense correction from the clinic list and labels cancelled history", async () => {
  const html = renderToStaticMarkup(await KlinikPengeluaranPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('href="/buku-besar/beban/expense"');
  expect(html).toContain("Detail / koreksi"); expect(html).toContain("Dibatalkan");
});
it.each(["STAFF", "inactive"])("hides clinic correction entry for %s", async role => {
  if (role === "inactive") fixture.active = false; else fixture.role = role;
  const html = renderToStaticMarkup(await KlinikPengeluaranPage({ searchParams: Promise.resolve({}) }));
  expect(html).not.toContain("Detail / koreksi");
});
it("opens the sale correction detail from an online receipt number", async () => {
  const html = renderToStaticMarkup(await PenjualanOnlinePage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('href="/penjualan/sale"'); expect(html).toContain("WA-001");
});
