import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { table: string; fields: string; count: boolean; head: boolean; filters: [string, string, unknown][]; range?: [number, number]; pages: number }[]);
// kasirGrooming: qty per POS grooming line visible to the viewer (RLS-scoped by the fixture), on completed sales.
// kasirPending: qty per POS grooming line whose planned payment was never finalized (not a sale yet).
const fixture = vi.hoisted(() => ({ role: "OWNER", visits: 1400, grooming: 1205, groomingError: false, kasirGrooming: [] as number[], kasirPending: [] as number[], kasirError: false }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/components/Charts", () => ({ Donut: () => null, LineChart: () => null, CashFlowChart: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    const call = { table, fields: "", count: false, head: false, filters: [] as [string, string, unknown][], range: undefined as [number, number] | undefined, pages: 0 };
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
      is(field: string, value: unknown) { call.filters.push(["is", field, value]); return query; },
      order(field: string) { call.filters.push(["order", field, true]); return query; },
      range(from: number, to: number) { call.range = [from, to]; call.pages += 1; return query; },
      maybeSingle: async () => ({ data: { role: fixture.role }, error: null }),
      then(resolve: (value: unknown) => unknown) {
        if (table === "sale_items") {
          // Embedded sales alternate between object and array shapes; both must be read.
          const completed = { payment_plan: null, payments_finalized_at: null, voided_at: null };
          const pending = { payment_plan: [{ method: "Tunai" }], payments_finalized_at: null, voided_at: null };
          const rows = [
            ...fixture.kasirGrooming.map((qty, index) => ({ id: `line-${index}`, qty, sales: index % 2 ? [completed] : completed })),
            ...fixture.kasirPending.map((qty, index) => ({ id: `pending-${index}`, qty, sales: index % 2 ? [pending] : pending })),
          ];
          const [from, to] = call.range ?? [0, rows.length - 1];
          return Promise.resolve(fixture.kasirError ? { data: null, count: null, error: { message: "fixture read error" } }
            : { data: rows.slice(from, to + 1), count: rows.length, error: null }).then(resolve);
        }
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
  const groomingQuery = calls.find((call) => call.table === "visits" && call.count && call.head && call.filters.some(([op, field]) => op === "ilike" && field === "poli"));
  expect(groomingQuery).toBeDefined();
  expect(groomingQuery?.filters.some(([op, field]) => op === "eq" && field === "status")).toBe(false);
  expect(groomingQuery?.filters.some(([, field]) => field === "branch_id")).toBe(false);
  const from = groomingQuery?.filters.find(([op, field]) => op === "gte" && field === "created_at")?.[2];
  const until = groomingQuery?.filters.find(([op, field]) => op === "lt" && field === "created_at")?.[2];
  expect(new Date(String(until)).getTime() - new Date(String(from)).getTime()).toBe(86_400_000);
  expect(new Date(String(from)).getUTCHours()).toBe(17); // WIB midnight
  const waitingQuery = calls.find((call) => call.table === "visits" && call.filters.some(([op, field, value]) => op === "eq" && field === "status" && value === "Menunggu"));
  expect(waitingQuery?.filters.some(([op, field]) => op === "lt" && field === "created_at")).toBe(true);
});

it("renders the branch-scoped count returned by the authenticated client", async () => {
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

it("adds grooming services sold at the POS cashier, read completely past the API page limit", async () => {
  // 1203 POS grooming lines (one with qty 2) -> 1204 units; clinic 1205 -> 2409 total.
  fixture.kasirGrooming = [2, ...Array.from({ length: 1202 }, () => 1)];
  try {
    const html = await renderOperationalDashboard();
    expect(html).toMatch(/Grooming hari ini<\/div><div class="kval"[^>]*>2409<\/div>/);
    expect(html).toContain("Klinik 1205 · Kasir 1204");
    const kasir = calls.filter((call) => call.table === "sale_items" && call.count);
    expect(kasir).toHaveLength(1);
    expect(kasir[0].pages).toBeGreaterThan(2); // paged, never one truncated read
    const filters = kasir[0].filters;
    expect(filters).toContainEqual(["eq", "items.item_type", "Jasa"]);
    expect(filters).toContainEqual(["eq", "items.tindakan_kategori", "Grooming"]);
    expect(filters).toContainEqual(["is", "sales.voided_at", null]);
    expect(filters.some(([, field]) => field === "sales.branch_id")).toBe(false); // RLS scopes branches
    const from = filters.find(([op, field]) => op === "gte" && field === "sales.created_at")?.[2];
    const until = filters.find(([op, field]) => op === "lt" && field === "sales.created_at")?.[2];
    expect(new Date(String(until)).getTime() - new Date(String(from)).getTime()).toBe(86_400_000);
    expect(new Date(String(from)).getUTCHours()).toBe(17); // WIB midnight, exclusive end
  } finally {
    fixture.kasirGrooming = [];
  }
});

it("shows the clinic and cashier breakdown, and a marker when the cashier count cannot be read", async () => {
  fixture.visits = 4; fixture.grooming = 3;
  try {
    const zero = await renderOperationalDashboard();
    expect(zero).toMatch(/Grooming hari ini<\/div><div class="kval"[^>]*>3<\/div>/);
    expect(zero).toContain("Klinik 3 · Kasir 0");
    fixture.kasirError = true;
    const failed = await renderOperationalDashboard();
    expect(failed).toMatch(/Grooming hari ini<\/div><div class="kval"[^>]*>—<\/div>/);
    expect(failed).toContain("Klinik 3 · Kasir —");
    expect(failed).toContain("Angka grooming kasir belum dapat dibaca");
  } finally {
    fixture.visits = 1400; fixture.grooming = 1205; fixture.kasirError = false;
  }
});

it("leaves out cashier grooming on a sale whose planned payment never finalized, like the omzet tile", async () => {
  // Completed lines 1 + 2 -> 3 units; the orphaned planned sale (5 + 4 units) is not a sale yet.
  fixture.visits = 4; fixture.grooming = 3; fixture.kasirGrooming = [1, 2]; fixture.kasirPending = [5, 4];
  try {
    const html = await renderOperationalDashboard();
    expect(html).toMatch(/Grooming hari ini<\/div><div class="kval"[^>]*>6<\/div>/);
    expect(html).toContain("Klinik 3 · Kasir 3");
    expect(html).toContain("pembayarannya belum selesai tidak dihitung");
    const kasir = calls.find((call) => call.table === "sale_items" && call.count);
    expect(kasir?.fields).toContain("sales!inner(created_at, payment_plan, payments_finalized_at, voided_at)");
  } finally {
    fixture.visits = 1400; fixture.grooming = 1205; fixture.kasirGrooming = []; fixture.kasirPending = [];
  }
});
