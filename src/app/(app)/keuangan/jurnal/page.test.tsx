import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ role: "FINANCE", active: true, entries: [] as Record<string, unknown>[], recurring: [] as Record<string, unknown>[] }));
vi.stubGlobal("React", React);
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fiction-finance" } } }) },
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const query = {
      select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; },
      in(key: string, values: unknown[]) { filters[`in:${key}`] = values; return query; },
      gte() { return query; }, lte() { return query; }, or() { return query; }, order() { return query; }, limit() { return query; },
      maybeSingle() { return Promise.resolve({ data: { role: fixture.role, is_active: fixture.active }, error: null }); },
      then(resolve: (value: unknown) => unknown) {
        const all = table === "journal_entries" ? fixture.entries : table === "recurring_journals" ? fixture.recurring : [];
        const data = all.filter((row) => Object.entries(filters).every(([key, value]) => key.startsWith("in:")
          ? (value as unknown[]).includes(row[key.slice(3)]) : row[key] === value));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
      rpc() { return Promise.resolve({ data: null, error: null }); },
    };
    return query;
  },
}) }));
vi.mock("@/app/(app)/keuangan/jurnal/JurnalForm", () => ({ JurnalForm: () => null }));
vi.mock("@/app/(app)/keuangan/jurnal/JurnalCorrectionForm", () => ({ JurnalCorrectionForm: () => null }));
import Page from "@/app/(app)/keuangan/jurnal/page";

const ENTRY = "f5000000-0000-4000-8000-000000000001";
const OTHER = "f5000000-0000-4000-8000-000000000002";
const SCHEDULE = "f5000000-0000-4000-8000-000000000003";
function journal(id: string, source = "manual", source_ref: string | null = null, voided_at: string | null = null) {
  return { id, no_jurnal: `JU-${id.slice(-1)}`, tanggal: "2026-10-20", deskripsi: "Fixture journal", source, source_ref, branch_id: null,
    branches: null, revision: 0, voided_at, journal_lines: [{ debit: 100, credit: 0, coa_accounts: { id: "fiction-account", code: "6001", name: "Fixture" } },
      { debit: 0, credit: 100, coa_accounts: { id: "fiction-account-2", code: "2101", name: "Fixture credit" } }] };
}

beforeEach(() => {
  fixture.role = "FINANCE"; fixture.active = true; fixture.recurring = [];
  fixture.entries = [journal(ENTRY), journal(OTHER)];
});

it("filters to the exact journal and offers an authorized source schedule link", async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ entry: ENTRY }) }));
  expect(html).toContain(`href="/keuangan/jurnal-berulang/dari-jurnal/${ENTRY}"`);
  expect(html).toContain("JU-1");
  expect(html).not.toContain("JU-2");
});

it("links a recurring receipt to its exact schedule and hides setup for inactive users", async () => {
  fixture.role = "FINANCE"; fixture.active = false;
  fixture.entries = [journal(ENTRY, "recurring", `${SCHEDULE}:2026-10`)];
  fixture.recurring = [{ id: SCHEDULE, is_source_schedule: true }];
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ entry: ENTRY }) }));
  expect(html).toContain(`href="/keuangan/jurnal-berulang/${SCHEDULE}"`);
  expect(html).not.toContain("Buat jadwal dari jurnal");
});

it("keeps legacy recurring references out of the source-only detail route", async () => {
  fixture.entries = [journal(ENTRY, "recurring", `${SCHEDULE}:2026-10`)];
  fixture.recurring = [{ id: SCHEDULE, is_source_schedule: false }];
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ entry: ENTRY }) }));
  expect(html).not.toContain(`href="/keuangan/jurnal-berulang/${SCHEDULE}"`);
  expect(html).toContain(`${SCHEDULE}:2026-10`);
});

it("does not offer a source schedule from voided journals", async () => {
  fixture.entries = [journal(ENTRY, "manual", null, "2026-10-21T00:00:00Z")];
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ entry: ENTRY }) }));
  expect(html).not.toContain("Buat jadwal dari jurnal");
});
