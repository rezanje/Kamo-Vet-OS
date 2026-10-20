import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("unexpected redirect"); } }));
vi.mock("@/app/kasir/KasirClient", () => ({ KasirClient: () => <div>Editable cashier</div> }));
vi.mock("@/app/(app)/pos/transaksi/PosClient", () => ({ PosClient: () => <div>Editable backoffice</div> }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift", branch_id: "branch", branchName: "Cabang" }) }));
vi.mock("@/lib/penjual", () => ({ daftarPenjual: async () => [] }));
vi.mock("@/lib/kasir-catalog", () => ({ loadKasirItems: async () => [], loadKasirCatalogDetails: async () => ({ stock: [], prices: [], tiers: [], discounts: [] }), loadKasirGroupComponents: async () => [] }));
vi.mock("@/lib/satuan", () => ({ loadUnitOptions: async () => new Map(), loadItemUnits: async () => new Map(), unitOptions: () => [] }));
vi.mock("@/lib/promo-hitung", () => ({ loadPromoAktif: async () => [] }));
vi.mock("@/lib/harga-golongan", () => ({ loadAturanDiskon: async () => [], loadInfoBarang: async () => new Map() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "cashier" } } }) },
  from() {
    const query = { select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query, range: () => query,
      maybeSingle: async () => ({ data: { id: "fixture" }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve) };
    return query;
  },
}) }));
import KasirPage from "@/app/kasir/page";
import PosPage from "@/app/(app)/pos/transaksi/page";

it.each([
  { kind: "cashier", Page: KasirPage, receipt: "/kasir/struk" },
  { kind: "backoffice", Page: PosPage, receipt: "/pos/struk" },
])("$kind gives an explicit path to the committed receipt after a changed retry", async ({ Page, receipt }) => {
  const markup = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ error: "Transaksi sebelumnya sudah tersimpan", completed_sale_id: "sale", draft_used: "used identity" }) }));
  expect(markup).toContain("Lihat struk &amp; mulai transaksi baru");
  expect(markup).toContain(`${receipt}/sale?draft_done=used%20identity`);
  expect(markup).toContain("Editable");
});

it.each([KasirPage, PosPage])("does not offer to clear an unconfirmed or unrelated draft", async Page => {
  for (const params of [{ error: "Belum selesai" }, { completed_sale_id: "sale" }, { draft_used: "identity" }]) {
    const markup = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
    expect(markup).not.toContain("Lihat struk &amp; mulai transaksi baru");
  }
});
