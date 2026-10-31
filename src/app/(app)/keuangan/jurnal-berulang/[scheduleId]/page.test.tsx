import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ schedule: {} as Record<string, unknown>, proof: {} as Record<string, unknown>, occurrences: [] as Record<string, unknown>[], failCount: false }));
vi.stubGlobal("React", React);
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const state: { filters: Record<string, unknown>; min?: string; max?: string; direction?: boolean; limit?: number; head: boolean; exact: boolean; from: number; to: number } = { filters: {}, head: false, exact: false, from: 0, to: 23 };
  const query = {
    select(_fields: string, options?: { count?: string; head?: boolean }) { state.exact = options?.count === "exact"; state.head = options?.head === true; return query; },
    eq(key: string, value: unknown) { state.filters[key] = value; return query; },
    gte(_key: string, value: string) { state.min = value; return query; },
    lte(_key: string, value: string) { state.max = value; return query; },
    order(_key: string, options?: { ascending?: boolean }) { state.direction = options?.ascending !== false; return query; },
    limit(value: number) { state.limit = value; return query; },
    range(from: number, to: number) { state.from = from; state.to = to; return query; },
    maybeSingle() {
      if (table !== "recurring_source_occurrences") return Promise.resolve({ data: table === "recurring_journals" ? fixture.schedule : fixture.proof, error: null });
      const rows = fixture.occurrences.filter((row) => Object.entries(state.filters).every(([key, value]) => row[key] === value))
        .filter((row) => !state.min || String(row.period) >= state.min)
        .filter((row) => !state.max || String(row.period) <= state.max)
        .sort((a, b) => String(a.period).localeCompare(String(b.period)) * (state.direction ? 1 : -1));
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    returns() { return query; },
    then(resolve: (value: unknown) => unknown) {
      const all = (table === "recurring_source_occurrences" ? fixture.occurrences : [])
        .filter((row) => Object.entries(state.filters).every(([key, value]) => row[key] === value))
        .filter((row) => !state.min || String(row.period) >= state.min)
        .filter((row) => !state.max || String(row.period) <= state.max)
        .sort((a, b) => (String(a.period).localeCompare(String(b.period)) * (state.direction ? 1 : -1)));
      const rows = state.head ? null : all.slice(0, state.limit ?? state.to - state.from + 1);
      return Promise.resolve({ data: rows, count: fixture.failCount && state.exact ? null : state.exact ? all.length : null, error: fixture.failCount && state.exact ? { message: "fixture error" } : null }).then(resolve);
    },
  };
  return query;
} }) }));
vi.mock("@/app/(app)/keuangan/jurnal-berulang/actions", () => ({ postRecurringSourcePeriod: async () => undefined }));
import Page from "@/app/(app)/keuangan/jurnal-berulang/[scheduleId]/page";

const SCHEDULE = "f4000000-0000-4000-8000-000000000001";
const SOURCE = "f4000000-0000-4000-8000-000000000002";
const ENTRY = "f4000000-0000-4000-8000-000000000003";
const snapshot = { entry_id: SOURCE, no_jurnal: "JU-FIKTIF-1", tanggal: "2025-12-31", branch_id: null, deskripsi: "Fixture", lines: [
  { line_id: "line-1", account_id: "account-1", code: "6001", debit: 1200, credit: 0 },
  { line_id: "line-2", account_id: "account-2", code: "311001", debit: 0, credit: 1200 },
] };

beforeEach(() => {
  fixture.failCount = false;
  fixture.schedule = { id: SCHEDULE, nama: "Jurnal dari sumber", day_of_month: 25, branch_id: null, is_active: true, max_occurrences: 2, last_posted: "2026-01", is_source_schedule: true };
  fixture.proof = { schedule_id: SCHEDULE, source_entry_id: SOURCE, branch_id: null, source_snapshot: snapshot,
    config: { name: "Fixture amortisasi", first_period: "2026-01", last_period: "2026-02", day: 25, count: 2, mode: "manual" }, created_at: "2026-01-01T00:00:00Z" };
  fixture.occurrences = [{ schedule_id: SCHEDULE, period: "2026-01", journal_id: ENTRY, executed_by: "fiction-user", executed_at: "2026-01-25T04:00:00Z", receipt: { schedule_id: SCHEDULE, period: "2026-01", entry_id: ENTRY, no_jurnal: "JU-FIKTIF-2", posted: true } }];
});

it("shows complete receipt history and offers only the next due period", async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ scheduleId: SCHEDULE }), searchParams: Promise.resolve({}) }));
  expect(html).toContain("Fixture amortisasi");
  expect(html).toContain("1 / 2");
  expect(html).toContain("JU-FIKTIF-2");
  expect(html).toContain("Buat jurnal periode 2026-02");
  expect(html).toContain("2026-02");
});

it("fails closed when receipt counts cannot be verified", async () => {
  fixture.failCount = true;
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ scheduleId: SCHEDULE }), searchParams: Promise.resolve({}) }));
  expect(html).toContain("Riwayat jadwal belum dapat dimuat dengan lengkap");
  expect(html).not.toContain("Buat jurnal periode");
});

it("disables next-period posting when the latest immutable receipt does not match", async () => {
  fixture.occurrences[0] = { ...fixture.occurrences[0], receipt: { schedule_id: "other-schedule", period: "2026-01", entry_id: ENTRY, no_jurnal: "JU-FIKTIF-2", posted: true } };
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ scheduleId: SCHEDULE }), searchParams: Promise.resolve({}) }));
  expect(html).toContain("progres dan receipt periode tidak cocok");
  expect(html).not.toContain("Buat jurnal periode");
});
