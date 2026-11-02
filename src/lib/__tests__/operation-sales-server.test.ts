import { describe, expect, it } from "vitest";
import { collectDashboard, resolveDashboardScope } from "../operation-sales-server";

type QueryRecord = { table: string; calls: { method: string; args: unknown[] }[] };
type Row = Record<string, unknown>;

function compareCell(a: unknown, b: unknown): number {
  const left = Date.parse(String(a));
  const right = Date.parse(String(b));
  if (!Number.isNaN(left) && !Number.isNaN(right)) return left - right;
  return String(a).localeCompare(String(b));
}

// Applies the recorded PostgREST filters to fixture rows, including filters on an
// embedded relation ("visits.branch_id"): with `relation!inner` the parent row is
// dropped when nothing matches, otherwise only the embedded value is nulled.
function applyFilters(rows: Row[], calls: QueryRecord["calls"]): Row[] {
  const select = String(calls.find((call) => call.method === "select")?.args[0] ?? "");
  let out = rows.map((row) => ({ ...row }));
  for (const { method, args } of calls) {
    if (!["eq", "in", "is", "gte", "lte", "gt", "lt"].includes(method)) continue;
    const [column, value] = args as [string, unknown];
    const test = (cell: unknown) => method === "in" ? (value as unknown[]).includes(cell)
      : method === "is" ? (cell ?? null) === value
      : method === "eq" ? cell === value
      : method === "gte" ? compareCell(cell, value) >= 0
      : method === "gt" ? compareCell(cell, value) > 0
      : method === "lt" ? compareCell(cell, value) < 0
      : compareCell(cell, value) <= 0;
    const dot = column.indexOf(".");
    if (dot < 0) {
      out = out.filter((row) => test(row[column]));
      continue;
    }
    const relation = column.slice(0, dot);
    const field = column.slice(dot + 1);
    const inner = select.includes(`${relation}!inner`);
    out = out.flatMap((row) => {
      const embedded = row[relation] as Row | Row[] | null | undefined;
      const list = Array.isArray(embedded) ? embedded : embedded ? [embedded] : [];
      const kept = list.filter((item) => test(item[field]));
      if (inner && kept.length === 0) return [];
      return [{ ...row, [relation]: Array.isArray(embedded) ? kept : kept[0] ?? null }];
    });
  }
  return out;
}

// Response shaping like PostgREST: `.order()` sorts, `.range()` picks the window, every
// response stops at `maxRows` (Supabase default 1000) even without a range, and `count`
// is only filled when the select asked for `{ count: "exact" }`.
function respond(rows: Row[], calls: QueryRecord["calls"], maxRows: number) {
  const options = calls.find((call) => call.method === "select")?.args[1] as { count?: string } | undefined;
  const orders = calls.filter((call) => call.method === "order")
    .map((call) => ({ column: String(call.args[0]), ascending: (call.args[1] as { ascending?: boolean } | undefined)?.ascending !== false }));
  const sorted = orders.length === 0 ? rows : [...rows].sort((a, b) => {
    for (const { column, ascending } of orders) {
      const diff = compareCell(a[column], b[column]);
      if (diff !== 0) return ascending ? diff : -diff;
    }
    return 0;
  });
  const range = calls.filter((call) => call.method === "range").at(-1)?.args as [number, number] | undefined;
  const [first, last] = range ?? [0, Number.MAX_SAFE_INTEGER];
  return {
    data: sorted.slice(first, Math.min(last + 1, first + maxRows)),
    count: options?.count === "exact" ? rows.length : null,
  };
}

function fakeSupabase(options: {
  role?: string;
  assignments?: string[];
  branches?: { id: string; name: string }[];
  errors?: Record<string, { message: string; code?: string }>;
  layers?: { warehouse_id: string; item_id: string; qty_left: number; unit_cost: number }[];
  sales?: Record<string, unknown>[];
  returns?: Record<string, unknown>[];
  /** Fixture rows whose recorded filters are actually applied (see applyFilters). */
  tables?: Record<string, Row[]>;
  /** Server row cap per response (PostgREST max-rows). */
  maxRows?: number;
}) {
  const records: QueryRecord[] = [];
  const errors = options.errors ?? {};
  const maxRows = options.maxRows ?? 1000;
  const from = (table: string) => {
    const record: QueryRecord = { table, calls: [] };
    records.push(record);
    const fixed = options.tables?.[table] ? null : table === "profiles"
      ? [{ role: options.role ?? "OWNER" }]
      : table === "user_branches"
        ? (options.assignments ?? []).map((branch_id) => ({ branch_id }))
        : table === "branches"
          ? (options.branches ?? [{ id: "b1", name: "Cabang Satu" }])
          : table === "warehouses"
            ? [{ id: "w1", branch_id: "b1" }]
          : table === "stock_layers"
            ? options.layers ?? []
          : table === "sales" ? options.sales ?? [] : table === "sales_returns" ? options.returns ?? [] : [];
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "gte", "lte", "lt", "gt", "is", "not", "neq", "order", "range", "limit", "maybeSingle"]) {
      query[method] = (...args: unknown[]) => {
        record.calls.push({ method, args });
        return query;
      };
    }
    query.then = (resolve: (value: unknown) => unknown) => {
      const error = errors[table] ?? null;
      const rows = fixed ?? applyFilters(options.tables![table], record.calls);
      return Promise.resolve(error ? { data: null, error, count: null } : { ...respond(rows, record.calls, maxRows), error: null }).then(resolve);
    };
    return query;
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      records.push({ table: `rpc:${name}`, calls: [{ method: "rpc", args: [args] }] });
      return { data: args.b === "foreign" ? false : true, error: null };
    },
    records,
  };
  return supabase;
}

describe("operation sales server collector", () => {
  it("deducts merchandise refunds separately from returned merchant fee", async () => {
    const result = await collectDashboard(fakeSupabase({
      sales: [{ id: "sale", total: 101600.01, merchant_fee_total: 1600.01, branch_id: "b1", customer_id: "c1", channel: null, created_at: "2026-08-15T05:00:00Z",
        sale_items: [{ item_id: "item", qty: 1, harga: 100000, hpp: 50000 }] }],
      returns: [{ id: "ret", sale_id: "sale", total: 50800 }],
    }), { from: "2026-08-01", to: "2026-08-31", branchIds: ["b1"], channel: "all" });
    expect(result.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 50000, transactions: 1 } } });
  });
  it("excludes merchant fee from product sales, margin, targets and customer spending", async () => {
    const sale = { id: "sale", total: 101600, merchant_fee_total: 1600, branch_id: "b1", customer_id: "c1", channel: null, created_at: "2026-08-15T05:00:00Z",
      sale_items: [{ item_id: "item", qty: 1, harga: 100000, hpp: 50000 }],
      payment_plan: [{ method: "Tunai", amount: 20000 }, { method: "Debit", amount: 81600, fee_percent: 2, fee_amount: 1600 }], payments_finalized_at: "2026-08-15T05:00:01Z" };
    const result = await collectDashboard(fakeSupabase({ sales: [sale, { ...sale, id: "pending", payments_finalized_at: null }] }), {
      from: "2026-08-01", to: "2026-08-31", branchIds: ["b1"], channel: "all",
    });
    expect(result.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 100000, transactions: 1, grossMargin: 50000 } } });
    expect(result.customer).toMatchObject({ status: "ready", data: { topSpenders: [{ customerId: "c1", spending: 100000 }] } });
  });
  it("counts finalized split sales once in revenue and customer spending while excluding pending sales", async () => {
    const sale = { id: "sale", total: 100000, branch_id: "b1", customer_id: "c1", channel: null, created_at: "2026-08-15T05:00:00Z",
      sale_items: [{ item_id: "item", qty: 1, harga: 100000, hpp: 50000 }],
      payment_plan: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }], payments_finalized_at: "2026-08-15T05:00:01Z" };
    const result = await collectDashboard(fakeSupabase({ sales: [sale, { ...sale, id: "pending", payments_finalized_at: null }] }), {
      from: "2026-08-01", to: "2026-08-31", branchIds: ["b1"], channel: "all",
    });
    expect(result.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 100000, transactions: 1 } } });
    expect(result.customer).toMatchObject({ status: "ready", data: { topSpenders: [{ customerId: "c1", spending: 100000 }] } });
  });

  it.each(["ADMIN", "OWNER", "FINANCE"])("tidak membaca atau menyerialisasi biaya FIFO pada dashboard %s", async role => {
    const supabase = fakeSupabase({ role, layers: [
      { warehouse_id: "w1", item_id: "i1", qty_left: 2.5, unit_cost: 120 },
      { warehouse_id: "w1", item_id: "i1", qty_left: 3, unit_cost: 200 },
    ] });
    const result = await collectDashboard(supabase, {
      from: "2026-08-01", to: "2026-08-31", branchIds: ["b1"], channel: "all",
    });
    expect(result.stock.status).toBe("ready");
    expect(supabase.records.some(record => record.table === "stock_layers")).toBe(false);
    expect(JSON.stringify(result.stock)).not.toMatch(/stockValue|unit_cost|unitCost/);
    if (result.stock.status === "ready") expect(result.stock.data).toHaveProperty("coverageDays");
  });
  it("menolak cabang asing sebelum query blok dashboard berjalan", async () => {
    const supabase = fakeSupabase({ role: "STAFF", assignments: ["b1"] });

    await expect(resolveDashboardScope(supabase, ["foreign"])).rejects.toThrow("Akses cabang ditolak");
    expect(supabase.records.some((record) => ["sales", "stock", "purchase_orders", "bookings", "visits"].includes(record.table))).toBe(false);
  });

  it("mengirim periode dan branch scope ke query data", async () => {
    const supabase = fakeSupabase({ role: "OWNER", branches: [{ id: "b1", name: "Cabang Satu" }] });
    const result = await collectDashboard(supabase, {
      from: "2026-08-01",
      to: "2026-08-31",
      branchIds: ["b1"],
      channel: "all",
    });

    expect(result.sales.status).toBe("ready");
    for (const table of ["sales", "visits", "bookings", "purchase_orders", "return_record_effective_stock_moves"]) {
      const records = supabase.records.filter((record) => record.table === table);
      expect(records.length, table).toBeGreaterThan(0);
      const calls = records.flatMap((record) => record.calls);
      const scopedId = table === "return_record_effective_stock_moves" ? "w1" : "b1";
      expect(calls.some((call) => call.method === "in" && JSON.stringify(call.args).includes(scopedId)), table).toBe(true);
      expect(calls.some((call) => call.method === "gte" && JSON.stringify(call.args).includes("2026-08-01")), table).toBe(true);
      expect(calls.some((call) => call.method === "lte" && JSON.stringify(call.args).includes("2026-08-31")), table).toBe(true);
    }
    const warehouseCalls = supabase.records.filter((record) => record.table === "warehouses").flatMap((record) => record.calls);
    expect(warehouseCalls.some((call) => call.method === "in" && JSON.stringify(call.args).includes("b1"))).toBe(true);
  });

  it("mengembalikan agregat dan mempertahankan blok lain saat satu query gagal", async () => {
    const supabase = fakeSupabase({
      role: "OWNER",
      branches: [{ id: "b1", name: "Cabang Satu" }],
      errors: { purchase_orders: { message: "query gagal", code: "500" } },
    });
    const result = await collectDashboard(supabase, {
      from: "2026-08-01",
      to: "2026-08-31",
      branchIds: ["b1"],
      channel: "all",
    });

    expect(result.sales.status).toBe("ready");
    expect(result.sales).not.toHaveProperty("rows");
    expect(result.purchase.status).toBe("error");
    if (result.purchase.status === "error") expect(result.purchase.correlationId).toBeTruthy();
  });
});

describe("omzet klinik mengikuti tanggal tagihan, bukan tanggal kunjungan", () => {
  const items = [{ item_id: "jasa", qty: 1, harga: 150000, hpp: 40000, jenis: "Jasa" }];
  const visit = (id: string, createdAt: string, branchId = "b1") => ({
    id, branch_id: branchId, customer_id: `cust-${id}`, status: "Selesai", created_at: createdAt,
  });
  const invoice = (id: string, visitRow: ReturnType<typeof visit>, createdAt: string, extra: Row = {}) => ({
    id, visit_id: visitRow.id, total: 150000, created_at: createdAt, voided_at: null,
    visits: { branch_id: visitRow.branch_id, customer_id: visitRow.customer_id }, invoice_items: items, ...extra,
  });
  const dashboard = (tables: Record<string, Row[]>, from: string, to: string, channel: "all" | "klinik" = "all") =>
    collectDashboard(fakeSupabase({ tables }), { from, to, branchIds: ["b1"], channel });

  it("kunjungan tgl D yang ditagih tgl D+1 masuk omzet D+1 saja, tanpa dobel", async () => {
    // Pasien shift malam: daftar 1 Nov 21:00 WIB, dibayar 2 Nov 01:30 WIB.
    const night = visit("v-night", "2026-11-01T14:00:00Z");
    const tables = { visits: [night], invoices: [invoice("inv-night", night, "2026-11-01T18:30:00Z")] };

    const dayD = await dashboard(tables, "2026-11-01", "2026-11-01");
    expect(dayD.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 0, transactions: 0 } } });
    // Jumlah kunjungan tetap milik tanggal daftar kunjungan.
    expect(dayD.clinic).toMatchObject({ status: "ready", data: { branches: [{ visits: { total: 1 } }] } });

    const dayD1 = await dashboard(tables, "2026-11-02", "2026-11-02");
    expect(dayD1.sales).toMatchObject({ status: "ready", data: {
      metrics: { sales: 150000, transactions: 1, grossMargin: 110000 },
      split: { clinic: 150000 },
      branches: [{ branchId: "b1", sales: 150000, uniqueCustomers: 1 }],
    } });
    expect(dayD1.clinic).toMatchObject({ status: "ready", data: { branches: [{ visits: { total: 0 } }] } });

    const both = await dashboard(tables, "2026-11-01", "2026-11-02");
    expect(both.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 150000, transactions: 1 } } });
  });

  it("kunjungan 31 Okt yang dibayar 1 Nov masuk laporan November, tidak hilang dari dua bulan", async () => {
    // Daftar 31 Okt 22:00 WIB, dibayar 1 Nov 01:30 WIB (masih 31 Okt kalau dibaca UTC).
    const lastNight = visit("v-oct", "2026-10-31T15:00:00Z");
    const tables = { visits: [lastNight], invoices: [invoice("inv-nov", lastNight, "2026-10-31T18:30:00Z")] };

    const october = await dashboard(tables, "2026-10-01", "2026-10-31", "klinik");
    expect(october.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 0, transactions: 0 } } });

    const november = await dashboard(tables, "2026-11-01", "2026-11-30", "klinik");
    expect(november.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 150000, transactions: 1 }, split: { clinic: 150000 } } });
  });

  it("tetap membuang tagihan batal dan tagihan cabang lain, dan query dibatasi tanggal tagihan + cabang kunjungan", async () => {
    const same = visit("v-same", "2026-11-02T02:00:00Z");
    const voided = visit("v-void", "2026-11-02T03:00:00Z");
    const other = visit("v-other", "2026-11-02T04:00:00Z", "b2");
    const supabase = fakeSupabase({ tables: {
      visits: [same, voided, other],
      invoices: [
        invoice("inv-same", same, "2026-11-02T05:00:00Z"),
        invoice("inv-void", voided, "2026-11-02T06:00:00Z", { voided_at: "2026-11-02T07:00:00Z" }),
        invoice("inv-other", other, "2026-11-02T08:00:00Z"),
      ],
    } });
    const result = await collectDashboard(supabase, { from: "2026-11-02", to: "2026-11-02", branchIds: ["b1"], channel: "all" });
    expect(result.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 150000, transactions: 1 } } });

    const invoiceCalls = supabase.records.filter((record) => record.table === "invoices").flatMap((record) => record.calls);
    expect(invoiceCalls).toContainEqual({ method: "in", args: ["visits.branch_id", ["b1"]] });
    expect(invoiceCalls).toContainEqual({ method: "is", args: ["voided_at", null] });
    expect(invoiceCalls).toContainEqual({ method: "gte", args: ["created_at", "2026-11-02T00:00:00+07:00"] });
    expect(invoiceCalls).toContainEqual({ method: "lte", args: ["created_at", "2026-11-02T23:59:59.999999+07:00"] });
    expect(String(invoiceCalls.find((call) => call.method === "select")?.args[0])).toContain("visits!inner(branch_id,customer_id)");
  });
});

describe("laporan membaca seluruh baris walau melebihi batas 1.000 baris per respons", () => {
  const pad = (n: number) => String(n).padStart(5, "0");
  const period = { from: "2026-08-01", to: "2026-08-31", branchIds: ["b1"], channel: "all" as const };
  const sale = (i: number) => ({
    id: `sale-${pad(i)}`, branch_id: "b1", customer_id: `cust-${pad(i)}`, total: 1000, merchant_fee_total: 0, channel: null,
    created_at: "2026-08-15T05:00:00Z", payment_plan: null, payments_finalized_at: null, voided_at: null,
    sale_items: [{ item_id: "item", qty: 1, harga: 1000, hpp: 400 }],
  });
  const inSizes = (supabase: ReturnType<typeof fakeSupabase>, table: string, column: string) => supabase.records
    .filter((record) => record.table === table).flatMap((record) => record.calls)
    .filter((call) => call.method === "in" && call.args[0] === column).map((call) => (call.args[1] as unknown[]).length);

  it("menghitung semua penjualan, retur, tagihan klinik, pelanggan, stok dan pembelian di atas 1.000 baris", async () => {
    const SALES = 1250, RETURNS = 1050, INVOICES = 1100, ITEMS = 1200, ORDERS = 1100;
    const sales = Array.from({ length: SALES }, (_, i) => sale(i));
    const returns = Array.from({ length: RETURNS }, (_, i) => ({ id: `ret-${pad(i)}`, sale_id: `sale-${pad(i)}`, total: 100, tanggal: "2026-08-20", voided_at: null }));
    const invoices = Array.from({ length: INVOICES }, (_, i) => ({
      id: `inv-${pad(i)}`, visit_id: `visit-${pad(i)}`, total: 2000, created_at: "2026-08-16T05:00:00Z", voided_at: null,
      visits: { branch_id: "b1", customer_id: `pasien-${pad(i)}` }, invoice_items: [{ item_id: "jasa", qty: 1, harga: 2000, hpp: 0, jenis: "Jasa" }],
    }));
    const items = Array.from({ length: ITEMS }, (_, i) => ({ id: `item-${pad(i)}`, min_stock: 5, is_active: true }));
    const stock = items.map((item, i) => ({ id: `stock-${pad(i)}`, warehouse_id: "w1", item_id: item.id, qty: 1, updated_at: "2026-08-10T00:00:00Z" }));
    const orders = Array.from({ length: ORDERS }, (_, i) => ({
      id: `po-${pad(i)}`, branch_id: "b1", tanggal: "2026-08-05", total: 10, status: "Selesai",
      purchase_order_items: [{ item_id: "item", qty: 2, harga_beli: 5 }],
    }));
    const purchaseInvoices = orders.map((order, i) => ({
      id: `pi-${pad(i)}`, po_id: order.id, total: 10, tanggal: "2026-08-06", voided_at: null, supplier_id: "sup",
      suppliers: { nama: "Pemasok" }, purchase_invoice_items: [{ item_id: "item", qty: 1, harga: 10 }],
    }));
    const supabase = fakeSupabase({ tables: {
      sales, sales_returns: returns, invoices, items, stock, purchase_orders: orders, purchase_invoices: purchaseInvoices,
    } });

    const result = await collectDashboard(supabase, period);

    const product = SALES * 1000 - RETURNS * 100;
    expect(result.sales).toMatchObject({ status: "ready", data: {
      metrics: { sales: product + INVOICES * 2000, transactions: SALES + INVOICES },
      split: { product, service: 0, clinic: INVOICES * 2000 },
    } });
    expect(result.branch).toMatchObject({ status: "ready", data: [{ branchId: "b1", sales: product + INVOICES * 2000, uniqueCustomers: SALES + INVOICES }] });
    expect(result.customer).toMatchObject({ status: "ready", data: { totalCustomers: SALES } });
    expect(result.stock).toMatchObject({ status: "ready", data: { lowStock: ITEMS } });
    expect(result.purchase).toMatchObject({ status: "ready", data: { purchase: ORDERS * 10, outstandingPoQty: ORDERS } });

    // Id lists stay short enough for the proxy: returns and purchase invoices are read per batch.
    expect(inSizes(supabase, "sales_returns", "sale_id").length).toBeGreaterThan(1);
    expect(Math.max(...inSizes(supabase, "sales_returns", "sale_id"))).toBeLessThanOrEqual(100);
    expect(Math.max(...inSizes(supabase, "purchase_invoices", "po_id"))).toBeLessThanOrEqual(100);
  });

  it("halaman yang dipotong server menjadikan blok error, bukan angka yang lebih kecil", async () => {
    // Server cap below the requested page: 450 rows exist, a page only ever returns 400.
    const supabase = fakeSupabase({ tables: { sales: Array.from({ length: 450 }, (_, i) => sale(i)) }, maxRows: 400 });

    const result = await collectDashboard(supabase, period);

    expect(result.sales.status).toBe("error");
    expect(result.branch.status).toBe("error");
    expect(result.customer.status).toBe("error");
    if (result.sales.status === "error") expect(result.sales.correlationId).toBeTruthy();
    expect(result.stock.status).toBe("ready");
    expect(result.purchase.status).toBe("ready");
  });

  it("tabel/kolom yang belum ada tetap jadi blok 'missing' lewat pembacaan berhalaman", async () => {
    const supabase = fakeSupabase({ errors: {
      // PGRST204's message has no "does not exist": only the preserved code identifies it.
      items: { code: "PGRST204", message: "Could not find the 'min_stock' column of 'items' in the schema cache" },
      sales: { code: "42703", message: "column sales.merchant_fee_total does not exist" },
      purchase_orders: { code: "500", message: "query gagal" },
    } });

    const result = await collectDashboard(supabase, period);

    expect(result.stock).toEqual({ status: "missing", reason: "Data sumber belum tersedia" });
    expect(result.sales).toEqual({ status: "missing", reason: "Data sumber belum tersedia" });
    expect(result.customer).toEqual({ status: "missing", reason: "Data sumber belum tersedia" });
    expect(result.purchase.status).toBe("error");
    expect(result.clinic.status).toBe("ready");
  });
});

describe("blok klinik membaca seluruh baris walau melebihi batas 1.000 baris per respons", () => {
  const pad = (n: number) => String(n).padStart(5, "0");
  const twoBranches = [{ id: "b1", name: "Cabang Satu" }, { id: "b2", name: "Cabang Dua" }];
  const perBranch = (count: number, make: (branchId: string, i: number) => Row) =>
    twoBranches.flatMap((branch) => Array.from({ length: count }, (_, i) => make(branch.id, i)));
  const pagedTables = (supabase: ReturnType<typeof fakeSupabase>) => new Set(supabase.records
    .filter((record) => record.calls.some((call) => call.method === "range" && Number(call.args[0]) > 0))
    .map((record) => record.table));

  it("laporan bulanan semua cabang menghitung semua booking, kunjungan, follow-up, rujukan dan rawat inap", async () => {
    // Tiap cabang di bawah 1.000 baris, gabungan semua cabang di atasnya. Follow-up dan rawat
    // inap tidak punya batas tanggal bawah, jadi riwayat lama ikut terbaca.
    const tables: Record<string, Row[]> = {
      bookings: [
        ...perBranch(600, (b, i) => ({ id: `booking-${b}-${pad(i)}`, branch_id: b, status: "dikonfirmasi",
          attendance_outcome: ["hadir", "no_show", null][i % 3], tanggal: "2026-08-10" })),
        // Di luar periode: tidak dihitung.
        ...perBranch(10, (b, i) => ({ id: `booking-old-${b}-${pad(i)}`, branch_id: b, status: "dikonfirmasi", attendance_outcome: "hadir", tanggal: "2026-07-31" })),
      ],
      visits: perBranch(650, (b, i) => ({ id: `visit-${b}-${pad(i)}`, branch_id: b, status: i % 2 === 0 ? "Selesai" : "Dalam Pemeriksaan",
        created_at: "2026-08-12T03:00:00Z", checked_in_at: "2026-08-12T03:00:00Z", service_started_at: "2026-08-12T03:10:00Z",
        service_finished_at: "2026-08-12T03:30:00Z", checked_out_at: null })),
      follow_ups: [
        ...perBranch(700, (b, i) => {
          const tanggal = i < 400 ? "2025-03-15" : "2026-08-20";
          const done = i % 2 === 0;
          return { id: `fu-${b}-${pad(i)}`, branch_id: b, tanggal, status: done ? "Selesai" : "Terjadwal", completed_at: done ? `${tanggal}T02:00:00Z` : null };
        }),
        // Jatuh tempo setelah periode: tidak dihitung.
        ...perBranch(20, (b, i) => ({ id: `fu-next-${b}-${pad(i)}`, branch_id: b, tanggal: "2026-09-05", status: "Terjadwal", completed_at: null })),
      ],
      visit_referrals: perBranch(550, (b, i) => ({ id: `ref-${b}-${pad(i)}`, branch_id: b, direction: i % 2 === 0 ? "masuk" : "keluar", referred_at: "2026-08-14T04:00:00Z" })),
      inpatient_records: perBranch(700, (b, i) => i < 400
        // Riwayat lama, sudah pulang sebelum periode: terbaca tapi tidak mengisi kandang.
        ? { id: `ip-${b}-${pad(i)}`, branch_id: b, admitted_at: "2025-05-01T02:00:00Z", discharged_at: "2025-05-03T02:00:00Z" }
        // Masuk 31 Jul 17:00 WIB, pulang 1 Agu 17:00 WIB: satu hari-kandang di periode.
        : { id: `ip-${b}-${pad(i)}`, branch_id: b, admitted_at: "2026-07-31T10:00:00Z", discharged_at: "2026-08-01T10:00:00Z" }),
      branch_capacity_periods: twoBranches.map((branch) => ({ id: `cap-${branch.id}`, branch_id: branch.id, capacity: 400, valid_from: "2026-01-01", valid_until: null })),
    };
    const supabase = fakeSupabase({ branches: twoBranches, tables });

    const result = await collectDashboard(supabase, { from: "2026-08-01", to: "2026-08-31", branchIds: [], channel: "all" });

    const branch = (branchId: string) => ({
      branchId,
      bookings: { total: 600, hadir: 200, noShow: 200, pending: 200 },
      visits: { total: 650, selesai: 325, avgWaitMinutes: 10, avgServiceMinutes: 20 },
      followUps: { due: 700, completed: 350, rate: 0.5 },
      occupancy: { status: "ok", occupiedBedDays: 300, availableBedDays: 400 * 31, rate: 300 / (400 * 31) },
      referrals: { masuk: 275, keluar: 275, total: 550 },
    });
    expect(result.clinic).toEqual({ status: "ready", data: { from: "2026-08-01", to: "2026-08-31", branches: [branch("b1"), branch("b2")] } });
    // Sumber di atas 1.000 baris memang dibaca berhalaman, bukan satu respons terpotong.
    for (const table of ["bookings", "visits", "follow_ups", "visit_referrals", "inpatient_records"]) {
      expect(pagedTables(supabase).has(table), table).toBe(true);
    }
  });

  it("halaman klinik yang dipotong server menjadikan blok klinik error, bukan angka yang lebih kecil", async () => {
    // Server cap below the requested page: 450 follow-ups exist, a page only ever returns 400.
    const followUps = Array.from({ length: 450 }, (_, i) => ({
      id: `fu-b1-${pad(i)}`, branch_id: "b1", tanggal: "2026-08-20", status: "Selesai", completed_at: "2026-08-20T02:00:00Z",
    }));
    const supabase = fakeSupabase({ tables: { follow_ups: followUps }, maxRows: 400 });

    const result = await collectDashboard(supabase, { from: "2026-08-01", to: "2026-08-31", branchIds: ["b1"], channel: "all" });

    expect(result.clinic.status).toBe("error");
    if (result.clinic.status === "error") expect(result.clinic.correlationId).toBeTruthy();
    expect(result.sales.status).toBe("ready");
    expect(result.stock.status).toBe("ready");
  });

  it.each([
    // PGRST204's message has no "does not exist": only the preserved code identifies it.
    ["branch_capacity_periods", "missing", { code: "PGRST204", message: "Could not find the 'capacity' column of 'branch_capacity_periods' in the schema cache" }],
    ["visit_referrals", "missing", { code: "42P01", message: "relation \"public.visit_referrals\" does not exist" }],
    ["follow_ups", "error", { code: "500", message: "query gagal" }],
  ] as const)("sumber klinik %s yang gagal dibaca menjadi blok %s", async (table, status, error) => {
    const supabase = fakeSupabase({ errors: { [table]: error } });

    const result = await collectDashboard(supabase, { from: "2026-08-01", to: "2026-08-31", branchIds: ["b1"], channel: "all" });

    expect(result.clinic.status).toBe(status);
    if (status === "missing") expect(result.clinic).toEqual({ status: "missing", reason: "Data sumber belum tersedia" });
    expect(result.sales.status).toBe("ready");
  });
});

describe("retur struk petshop mengurangi omzet struk asalnya (sama dengan Laporan Transaksi)", () => {
  const sale = (id: string, createdAt: string, extra: Row = {}) => ({
    id, branch_id: "b1", customer_id: `cust-${id}`, total: 100000, merchant_fee_total: 0, channel: null,
    created_at: createdAt, payment_plan: null, payments_finalized_at: null, voided_at: null,
    sale_items: [{ item_id: "barang", qty: 1, harga: 100000, hpp: 60000, items: { item_type: "Barang", tindakan_kategori: null } }],
    ...extra,
  });
  const salesReturn = (id: string, saleId: string, total: number, tanggal: string, extra: Row = {}) => ({
    id, sale_id: saleId, total, tanggal, voided_at: null, ...extra,
  });
  const dashboard = (tables: Record<string, Row[]>, from: string, to: string) =>
    collectDashboard(fakeSupabase({ tables }), { from, to, branchIds: ["b1"], channel: "pos" });

  it("retur yang diposting setelah periode tetap memotong periode struk, bukan periode retur", async () => {
    // Struk 15 Okt, diretur 5 Nov: yang turun omzet Oktober (dulu baru ikut kalau retur ≤ akhir periode).
    const tables = {
      sales: [sale("s-oct", "2026-10-15T05:00:00Z")],
      sales_returns: [salesReturn("r-nov", "s-oct", 40000, "2026-11-05")],
    };
    const october = await dashboard(tables, "2026-10-01", "2026-10-31");
    expect(october.sales).toMatchObject({ status: "ready", data: {
      metrics: { sales: 60000, transactions: 1 }, split: { product: 60000 },
      branches: [{ branchId: "b1", sales: 60000 }],
    } });

    const november = await dashboard(tables, "2026-11-01", "2026-11-30");
    expect(november.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 0, transactions: 0 } } });

    const span = await dashboard(tables, "2026-10-01", "2026-11-30");
    expect(span.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 60000, transactions: 1 } } });
  });

  it("retur dalam periode tetap terpotong, retur void diabaikan, struk tanpa retur tetap", async () => {
    const supabase = fakeSupabase({ tables: {
      sales: [sale("s-ret", "2026-11-02T03:00:00Z"), sale("s-plain", "2026-11-02T04:00:00Z")],
      sales_returns: [
        salesReturn("r-a", "s-ret", 30000, "2026-11-02"),
        salesReturn("r-b", "s-ret", 10000, "2026-11-20"),
        salesReturn("r-void", "s-ret", 50000, "2026-11-02", { voided_at: "2026-11-03T01:00:00Z" }),
      ],
    } });
    const result = await collectDashboard(supabase, { from: "2026-11-02", to: "2026-11-02", branchIds: ["b1"], channel: "pos" });
    // s-ret: 100.000 − 30.000 − 10.000 = 60.000; s-plain: 100.000.
    expect(result.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 160000, transactions: 2 } } });

    const returnCalls = supabase.records.filter((record) => record.table === "sales_returns").flatMap((record) => record.calls);
    expect(returnCalls).toContainEqual({ method: "is", args: ["voided_at", null] });
    expect(returnCalls.some((call) => call.method === "gte" || call.method === "lte")).toBe(false);
  });

  it("daftar struk panjang dibaca returnya per 100 id tanpa ada yang terlewat atau dobel", async () => {
    const sales = Array.from({ length: 150 }, (_, index) => sale(`s-${index}`, "2026-11-02T03:00:00Z"));
    const returns = sales.map((row, index) => salesReturn(`r-${index}`, row.id, 1000, "2026-11-02"));
    const supabase = fakeSupabase({ tables: { sales, sales_returns: returns } });
    const result = await collectDashboard(supabase, { from: "2026-11-02", to: "2026-11-02", branchIds: ["b1"], channel: "pos" });
    expect(result.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 150 * 99000, transactions: 150 } } });

    const inLists = supabase.records.filter((record) => record.table === "sales_returns")
      .map((record) => record.calls.find((call) => call.method === "in")?.args[1] as string[]);
    // Blok cabang memakai muatan dokumen blok penjualan (satu muatan), dipecah jadi 2 potongan:
    // tiap id struk muncul tepat sekali.
    expect(inLists).toHaveLength(2);
    expect(inLists.every((ids) => ids.length <= 100)).toBe(true);
    const seen = new Map<string, number>();
    for (const id of inLists.flat()) seen.set(id, (seen.get(id) ?? 0) + 1);
    expect(seen.size).toBe(150);
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
    expect(result.branch).toMatchObject({ status: "ready", data: [{ branchId: "b1", sales: 150 * 99000, transactions: 150 }] });
  });
});

describe("refund klinik mengurangi omzet tagihan asalnya (sama dengan Laporan Transaksi)", () => {
  const items = [{ item_id: "jasa", qty: 1, harga: 150000, hpp: 40000, jenis: "Jasa" }];
  const invoice = (id: string, createdAt: string, extra: Row = {}, branchId = "b1") => ({
    id, visit_id: `v-${id}`, total: 150000, created_at: createdAt, voided_at: null,
    visits: { branch_id: branchId, customer_id: `cust-${id}` }, invoice_items: items, ...extra,
  });
  const refund = (id: string, invoiceId: string, total: number, tanggal: string, branchId = "b1") => ({
    id, invoice_id: invoiceId, total, tanggal, branch_id: branchId,
  });
  const dashboard = (tables: Record<string, Row[]>, from: string, to: string, channel: "all" | "klinik" = "all") =>
    collectDashboard(fakeSupabase({ tables }), { from, to, branchIds: ["b1"], channel });

  it("tagihan 150.000 dengan refund 50.000 jadi 100.000; tagihan tanpa refund tetap", async () => {
    const tables = {
      invoices: [invoice("inv-refund", "2026-11-02T03:00:00Z"), invoice("inv-plain", "2026-11-02T04:00:00Z")],
      clinic_refunds: [refund("rf-1", "inv-refund", 50000, "2026-11-02")],
    };
    const both = await dashboard(tables, "2026-11-02", "2026-11-02");
    expect(both.sales).toMatchObject({ status: "ready", data: {
      metrics: { sales: 250000, transactions: 2 },
      split: { clinic: 250000 },
      branches: [{ branchId: "b1", sales: 250000, transactions: 2 }],
    } });

    const refundedOnly = await dashboard({ ...tables, invoices: [tables.invoices[0]] }, "2026-11-02", "2026-11-02", "klinik");
    expect(refundedOnly.sales).toMatchObject({ status: "ready", data: {
      metrics: { sales: 100000, transactions: 1 }, split: { clinic: 100000 },
    } });

    const plainOnly = await dashboard({ ...tables, invoices: [tables.invoices[1]] }, "2026-11-02", "2026-11-02", "klinik");
    expect(plainOnly.sales).toMatchObject({ status: "ready", data: {
      metrics: { sales: 150000, transactions: 1, grossMargin: 110000 }, split: { clinic: 150000 },
    } });
  });

  it("refund yang diposting setelah periode tetap memotong periode tagihan, bukan periode refund", async () => {
    // Tagihan 31 Okt, refund 5 Nov: sama seperti Laporan Transaksi, yang turun omzet Oktober.
    const tables = {
      invoices: [invoice("inv-oct", "2026-10-31T05:00:00Z")],
      clinic_refunds: [refund("rf-nov", "inv-oct", 50000, "2026-11-05")],
    };
    const october = await dashboard(tables, "2026-10-01", "2026-10-31");
    expect(october.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 100000, transactions: 1 } } });

    const november = await dashboard(tables, "2026-11-01", "2026-11-30");
    expect(november.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 0, transactions: 0 } } });

    const span = await dashboard(tables, "2026-10-01", "2026-11-30");
    expect(span.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 100000, transactions: 1 } } });
  });

  it("beberapa refund dijumlah sekali; refund tagihan batal atau cabang lain tidak memotong apa pun", async () => {
    const supabase = fakeSupabase({ tables: {
      invoices: [
        invoice("inv-two", "2026-11-02T03:00:00Z"),
        invoice("inv-void", "2026-11-02T04:00:00Z", { voided_at: "2026-11-02T05:00:00Z" }),
        invoice("inv-other", "2026-11-02T06:00:00Z", {}, "b2"),
      ],
      clinic_refunds: [
        refund("rf-a", "inv-two", 30000, "2026-11-02"),
        refund("rf-b", "inv-two", 20000, "2026-11-03"),
        refund("rf-void", "inv-void", 150000, "2026-11-02"),
        refund("rf-other", "inv-other", 150000, "2026-11-02", "b2"),
      ],
    } });
    const result = await collectDashboard(supabase, { from: "2026-11-02", to: "2026-11-02", branchIds: ["b1"], channel: "all" });
    expect(result.sales).toMatchObject({ status: "ready", data: {
      metrics: { sales: 100000, transactions: 1 }, split: { clinic: 100000 },
    } });

    // Refund hanya dibaca untuk tagihan yang termuat; tanpa batas tanggal refund.
    const refundCalls = supabase.records.filter((record) => record.table === "clinic_refunds").flatMap((record) => record.calls);
    expect(refundCalls).toContainEqual({ method: "in", args: ["invoice_id", ["inv-two"]] });
    expect(refundCalls.some((call) => call.method === "gte" || call.method === "lte")).toBe(false);
  });

  it("tidak membaca refund kalau tidak ada tagihan, dan kanal non-klinik tidak menyentuh refund klinik", async () => {
    const empty = fakeSupabase({ tables: { invoices: [], clinic_refunds: [refund("rf", "inv-x", 50000, "2026-11-02")] } });
    await collectDashboard(empty, { from: "2026-11-02", to: "2026-11-02", branchIds: ["b1"], channel: "klinik" });
    expect(empty.records.some((record) => record.table === "clinic_refunds")).toBe(false);

    const pos = fakeSupabase({ tables: {
      invoices: [invoice("inv-1", "2026-11-02T03:00:00Z")],
      clinic_refunds: [refund("rf", "inv-1", 50000, "2026-11-02")],
    } });
    const result = await collectDashboard(pos, { from: "2026-11-02", to: "2026-11-02", branchIds: ["b1"], channel: "pos" });
    expect(result.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 0, transactions: 0 } } });
    expect(pos.records.some((record) => record.table === "clinic_refunds")).toBe(false);
  });

  it("daftar tagihan panjang dibaca refund-nya per 100 id tanpa ada yang terlewat atau dobel", async () => {
    const invoices = Array.from({ length: 150 }, (_, index) => invoice(`inv-${index}`, "2026-11-02T03:00:00Z"));
    const refunds = invoices.map((row, index) => refund(`rf-${index}`, row.id, 1000, "2026-11-02"));
    const supabase = fakeSupabase({ tables: { invoices, clinic_refunds: refunds } });
    const result = await collectDashboard(supabase, { from: "2026-11-02", to: "2026-11-02", branchIds: ["b1"], channel: "klinik" });
    expect(result.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 150 * (150000 - 1000), transactions: 150 } } });

    const inLists = supabase.records.filter((record) => record.table === "clinic_refunds")
      .map((record) => record.calls.find((call) => call.method === "in")?.args[1] as string[]);
    // Blok cabang memakai muatan dokumen blok penjualan (satu muatan), dipecah jadi 2 potongan:
    // tiap id tagihan muncul tepat sekali.
    expect(inLists).toHaveLength(2);
    expect(inLists.every((ids) => ids.length <= 100)).toBe(true);
    const seen = new Map<string, number>();
    for (const id of inLists.flat()) seen.set(id, (seen.get(id) ?? 0) + 1);
    expect(seen.size).toBe(150);
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
    expect(result.branch).toMatchObject({ status: "ready", data: [{ branchId: "b1", sales: 150 * (150000 - 1000), transactions: 150 }] });
  });

  it("refund di atas 1.000 baris dalam satu potongan id tetap terhitung semua", async () => {
    // 100 tagihan (satu potongan id) × 11 refund = 1.100 baris: lewat max-rows satu respons.
    const invoices = Array.from({ length: 100 }, (_, index) => invoice(`inv-${String(index).padStart(3, "0")}`, "2026-11-02T03:00:00Z"));
    const refunds = invoices.flatMap((row) => Array.from({ length: 11 }, (_, n) => refund(`rf-${row.id}-${String(n).padStart(2, "0")}`, row.id, 100, "2026-11-02")));
    const supabase = fakeSupabase({ tables: { invoices, clinic_refunds: refunds } });
    const result = await collectDashboard(supabase, { from: "2026-11-02", to: "2026-11-02", branchIds: ["b1"], channel: "klinik" });
    expect(result.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 100 * (150000 - 1100), transactions: 100 } } });
  });
});
