import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  props: {} as Record<string, unknown>,
  loadPromoAktif: vi.fn(async (_db: unknown, branch: string) => [{ id: `promo-${branch}`, name: "Promo aktif" }]),
  loadAturanDiskon: vi.fn(async () => [{ item_id: "item", item_category_id: null, diskon_persen: 25 }]),
  loadInfoBarang: vi.fn(async () => new Map([["item", { item_id: "item", category_id: "food", parent_category_id: "goods" }]])),
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/penjual", () => ({ daftarPenjual: async () => [{ id: "seller", nama: "Staf" }] }));
vi.mock("@/lib/satuan", () => ({ loadItemUnits: async () => new Map(), unitOptions: () => [{ unit: "pcs", factor: 1, sell_price: 100_000 }] }));
vi.mock("@/lib/promo-hitung", () => ({ loadPromoAktif: state.loadPromoAktif }));
vi.mock("@/lib/harga-golongan", () => ({ loadAturanDiskon: state.loadAturanDiskon, loadInfoBarang: state.loadInfoBarang }));
vi.mock("@/app/(app)/pos/transaksi/PosClient", () => ({ PosClient: (props: Record<string, unknown>) => { state.props = props; return <div />; } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "cashier" } } }) },
  from(table: string) {
    const rows: Record<string, unknown[]> = {
      items: [{ id: "item", name: "Pakan", unit: "pcs", sell_price: 100_000, target_species: "Kucing" }],
      // Hanya golongan aktif (filter is_active di query); pelanggan tidak lagi dimuat semua.
      customer_categories: [{ id: "member" }],
      branches: [{ id: "branch", code: "BR", name: "Cabang" }, { id: "other", code: "OTHER", name: "Lain" }],
      item_branch_prices: [],
    };
    const query = {
      select() { return query; }, eq() { return query; }, order() { return query; }, range() { return query; }, limit() { return query; },
      maybeSingle: async () => ({ data: { id: "open-shift" } }),
      then(resolve: (value: { data: unknown[]; count: number; error: null }) => unknown) { const data = rows[table] ?? []; return Promise.resolve(resolve({ data, count: data.length, error: null })); },
    };
    return query;
  },
}) }));
import TransaksiPage from "@/app/(app)/pos/transaksi/page";

it("supplies each branch's active promos and active customer discount exceptions to the actual POS client", async () => {
  renderToStaticMarkup(await TransaksiPage({ searchParams: Promise.resolve({}) }));
  expect(state.props.promoPerCabang).toEqual({ branch: [{ id: "promo-branch", name: "Promo aktif" }], other: [{ id: "promo-other", name: "Promo aktif" }] });
  expect(state.loadAturanDiskon).toHaveBeenCalledTimes(1);
  expect(state.loadAturanDiskon).toHaveBeenCalledWith(expect.anything(), "member");
  expect(state.props.aturanDiskon).toEqual({ member: [{ item_id: "item", item_category_id: null, diskon_persen: 25 }] });
  expect(state.props.infoBarang).toEqual({ item: { item_id: "item", category_id: "food", parent_category_id: "goods" } });
  // Daftar pelanggan tidak lagi dikirim ke layar POS — dicari di server sambil mengetik.
  expect(state.props.customers).toBeUndefined();
});
