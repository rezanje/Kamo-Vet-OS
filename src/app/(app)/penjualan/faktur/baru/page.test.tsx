import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: ["branch-a"] as string[] | null, boleh: true }));
vi.mock("next/link", () => ({ default: ({ children, ...p }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...p}>{children}</a> }));
vi.mock("@/lib/master-guard", () => ({ bolehTransaksiKas: async () => state.boleh }));
vi.mock("@/lib/branch-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/branch-access")>("@/lib/branch-access");
  return { ...actual, allowedBranchIds: async () => state.allowed };
});
vi.mock("@/lib/satuan", () => ({ loadItemUnits: async () => new Map() }));
vi.mock("@/lib/checked-list", () => ({ readCompleteList: async () => [{ id: "item", code: "SKU", name: "Royal Canin", unit: "sak", sell_price: 300000 }] }));
vi.mock("@/app/(app)/penjualan/BarisJualForm", () => ({ BarisJualForm: () => <div data-testid="baris" /> }));
vi.mock("@/app/(app)/penjualan/faktur/baru/actions", () => ({ buatFakturLangsung: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, order: () => query, limit: () => query, range: () => query,
      then: (resolve: (value: unknown) => unknown) => {
        const rows = table === "branches"
          ? [{ id: "branch-a", name: "Kampet Care" }, { id: "branch-b", name: "Cabang Lain" }]
          : table === "warehouses"
            ? [{ id: "wh-a", name: "Gudang Kampet", branch_id: "branch-a" }, { id: "wh-b", name: "Gudang Lain", branch_id: "branch-b" }]
            : table === "customers" ? [{ id: "cust", name: "Toko Hewan", phone: "0812" }] : [];
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve);
      },
    };
    return query;
  },
}) }));

import Page from "./page";
const render = async () => renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

beforeEach(() => { state.allowed = ["branch-a"]; state.boleh = true; });

it("hanya menawarkan cabang yang boleh diakses pengguna", async () => {
  const html = await render();
  expect(html).toContain("Kampet Care");
  expect(html).not.toContain("Cabang Lain");
});

it("hanya menawarkan gudang milik cabang yang boleh diakses", async () => {
  const html = await render();
  expect(html).toContain("Gudang Kampet");
  expect(html).not.toContain("Gudang Lain");
});

it("pengguna lintas cabang penuh melihat semua cabang aktif", async () => {
  state.allowed = null;
  const html = await render();
  expect(html).toContain("Kampet Care");
  expect(html).toContain("Cabang Lain");
});

it("menjelaskan jalan keluar kalau belum punya penempatan cabang", async () => {
  state.allowed = [];
  const html = await render();
  expect(html).toContain("Belum ada cabang yang bisa kamu akses");
  expect(html).not.toContain('name="customer_id"');
});

it("menyembunyikan formulir dari peran yang tidak boleh menerbitkan faktur", async () => {
  state.boleh = false;
  const html = await render();
  expect(html).not.toContain('name="customer_id"');
});

it("membawa identitas permintaan supaya pengiriman dan faktur tidak dobel", async () => {
  expect(await render()).toContain('name="request_key"');
});
