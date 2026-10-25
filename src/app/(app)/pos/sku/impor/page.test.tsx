import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  calls: [] as Array<{ kind: string | null; owner: string | null }>,
  masterError: false,
  masterStatus: "previewed",
  rejected: 0,
}));

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/master-guard", () => ({ bolehKelolaMaster: async () => true }));
vi.mock("./actions", () => ({ recoverInitialStock: vi.fn() }));
vi.mock("./ImporForm", () => ({ ImporForm: () => null }));
vi.mock("./GroupComponentImport", () => ({ GroupComponentImport: () => null }));
vi.mock("./InventoryImportWorkspace", () => ({
  InventoryImportWorkspace: ({ masterBatches, masterError }: { masterBatches: unknown; masterError: unknown }) =>
    <div data-master-batches={JSON.stringify(masterBatches)} data-master-error={String(masterError)} />,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fiction-owner" } } }) },
  from: () => {
    const filter = { kind: null as string | null, owner: null as string | null };
    const query = {
      select: () => query,
      eq: (key: string, value: string) => {
        if (key === "kind") filter.kind = value;
        if (key === "created_by") filter.owner = value;
        return query;
      },
      order: () => query,
      limit: async () => {
        fixture.calls.push(filter);
        if (filter.kind === "master_accurate") return fixture.masterError
          ? { data: null, error: { message: "fixture read error" } }
          : { data: [{ id: "saved-master-run", source_name: "sample.xlsx", status: fixture.masterStatus, summary: {
            Ditolak: fixture.rejected,
            progress: { phase: "mengimpor", completed: 40, total: 100, percentage: 40 },
          } }], error: null };
        return { data: [], error: null };
      },
    };
    return query;
  },
}) }));

import ImporBarangPage from "./page";

it("loads only the signed-in user's saved master runs on a fresh page visit", async () => {
  fixture.calls = [];
  fixture.masterError = false;
  const html = renderToStaticMarkup(await ImporBarangPage({ searchParams: Promise.resolve({}) }));
  expect(fixture.calls).toContainEqual({ kind: "master_accurate", owner: "fiction-owner" });
  expect(html).toContain("saved-master-run");
  expect(html).toContain("40");
});

it("passes through master-run read failures instead of presenting an empty list", async () => {
  fixture.masterError = true;
  const html = renderToStaticMarkup(await ImporBarangPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("fixture read error");
});

it("keeps rejected master rows visible when a saved run has posted", async () => {
  fixture.masterError = false;
  fixture.masterStatus = "posted";
  fixture.rejected = 3;
  try {
    const html = renderToStaticMarkup(await ImporBarangPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('&quot;rejectedCount&quot;:3');
  } finally {
    fixture.masterStatus = "previewed";
    fixture.rejected = 0;
  }
});
