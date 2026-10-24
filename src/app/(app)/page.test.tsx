import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { table: string; fields: string; count: boolean; head: boolean; filters: [string, string, unknown][] }[]);
const fixture = vi.hoisted(() => ({ role: "OWNER", visits: 1400, grooming: 1205, groomingError: false }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/components/Charts", () => ({ Donut: () => null, LineChart: () => null, CashFlowChart: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    const call = { table, fields: "", count: false, head: false, filters: [] as [string, string, unknown][] };
    calls.push(call);
    const query = {
      select(fields: string, options?: { count?: string; head?: boolean }) {
        call.fields = fields; call.count = options?.count === "exact"; call.head = options?.head === true;
        return query;
      },
      eq(field: string, value: unknown) { call.filters.push(["eq", field, value]); return query; },
      gt(field: string, value: unknown) { call.filters.push(["gt", field, value]); return query; },
      gte(field: string, value: unknown) { call.filters.push(["gte", field, value]); return query; },
      lte(field: string, value: unknown) { call.filters.push(["lte", field, value]); return query; },
      lt(field: string, value: unknown) { call.filters.push(["lt", field, value]); return query; },
      ilike(field: string, value: unknown) { call.filters.push(["ilike", field, value]); return query; },
      maybeSingle: async () => ({ data: { role: fixture.role }, error: null }),
      then(resolve: (value: unknown) => unknown) {
        const grooming = call.filters.some(([op, field, value]) => op === "ilike" && field === "poli" && value === "%grooming%");
        const data = table === "visits" && !call.head
          ? Array.from({ length: 1000 }, () => ({ poli: "Grooming" })) : [];
        return Promise.resolve({
          data: call.head ? null : data,
          count: call.count && table === "visits" ? (grooming ? fixture.grooming : fixture.visits) : 0,
          error: grooming && fixture.groomingError ? { message: "fixture read error" } : null,
        }).then(resolve);
      },
    };
    return query;
  },
}) }));
import Dashboard from "./page";

async function renderOperationalDashboard() {
  calls.length = 0;
  const outer = await Dashboard({ searchParams: Promise.resolve({ sudut: "operasional" }) });
  const inner = await (outer.type as (props: { sudut: "operasional" }) => Promise<React.ReactElement>)(outer.props as { sudut: "operasional" });
  return renderToStaticMarkup(inner);
}

it("shows the full all-branch grooming count when visit rows exceed the API page limit", async () => {
  const html = await renderOperationalDashboard();
  expect(html).toContain("Grooming hari ini");
  expect(html).toContain("1205");
  expect(html).toContain("1400");
  expect(html).toContain("semua status");
  expect(html).toContain("WIB");
  expect(calls.some((call) => call.table === "visits" && call.count && call.head && call.filters.some(([op, field]) => op === "ilike" && field === "poli"))).toBe(true);
});

it("shows only the visit count returned under a branch-limited account", async () => {
  fixture.role = "STAFF"; fixture.visits = 4; fixture.grooming = 3;
  try {
    const html = await renderOperationalDashboard();
    expect(html).toMatch(/Grooming hari ini<\/div><div class="kval"[^>]*>3<\/div>/);
    expect(html).not.toContain("1205");
  } finally {
    fixture.role = "OWNER"; fixture.visits = 1400; fixture.grooming = 1205;
  }
});

it("shows zero on an empty day and an unavailable marker on read errors", async () => {
  fixture.visits = 0; fixture.grooming = 0;
  try {
    expect(await renderOperationalDashboard()).toMatch(/Grooming hari ini<\/div><div class="kval"[^>]*>0<\/div>/);
    fixture.groomingError = true;
    const failed = await renderOperationalDashboard();
    expect(failed).toMatch(/Grooming hari ini<\/div><div class="kval"[^>]*>—<\/div>/);
    expect(failed).toContain("Sebagian angka klinik belum dapat dibaca");
  } finally {
    fixture.visits = 1400; fixture.grooming = 1205; fixture.groomingError = false;
  }
});
