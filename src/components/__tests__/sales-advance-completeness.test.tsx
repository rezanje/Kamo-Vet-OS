import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ failSecondPage: false, requested: [] as string[] }));
vi.mock("@/lib/master-guard", () => ({ bolehTransaksiKas: async () => false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (table: string) => {
    let start = 0;
    let end = 999;
    const query = {
      select: () => query,
      order: () => query,
      in: () => query,
      limit: () => query,
      range: (from: number, to: number) => { start = from; end = to; fixture.requested.push(`${table}:${from}-${to}`); return query; },
      then: (resolve: (result: unknown) => void) => {
        if (table !== "sales_advances") return resolve({ data: [], count: 0, error: null });
        if (fixture.failSecondPage && start > 0) return resolve({ data: null, count: 501, error: { message: "fictional read error" } });
        const rows = Array.from({ length: 501 }, (_, index) => ({
          id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`, no_um: `UJ.FICTION.${index}`, tanggal: "2026-10-24",
          jumlah: 100, terpakai: 0, status: "aktif", customers: null, sales_orders: null,
        }));
        return resolve({ data: rows.slice(start, Math.min(end + 1, start + 500)), count: rows.length, error: null });
      },
    };
    return query;
  },
}) }));
vi.mock("@/app/(app)/penjualan/uang-muka/actions", () => ({ batalkanUangMukaJual: async () => {}, terimaUangMukaJual: async () => {} }));
vi.mock("@/components/PilihRekening", () => ({ loadRekeningAktif: async () => [], PilihRekening: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

import SalesAdvances from "@/app/(app)/penjualan/uang-muka/page";

beforeEach(() => { fixture.failSecondPage = false; fixture.requested = []; });

it("loads the older sales advance and its total beyond the first source page", async () => {
  const html = renderToStaticMarkup(await SalesAdvances({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('id="advance-10000000-0000-4000-8000-000000000500"');
  expect(html).toContain("Rp 50.100");
  expect(fixture.requested).toContain("sales_advances:500-999");
});

it("does not show a partial advance total when the next page fails", async () => {
  fixture.failSecondPage = true;
  const html = renderToStaticMarkup(await SalesAdvances({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("belum dapat dimuat lengkap");
  expect(html).not.toContain("Rp 50.000");
});
