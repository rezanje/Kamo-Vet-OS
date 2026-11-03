import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  role: "OWNER", active: true,
  tables: {} as Record<string, Row[]>,
  reads: [] as { table: string; select: string; from: number; to: number; filters: Record<string, unknown>; ids: unknown[] }[],
  rpc: [] as { name: string; args: Record<string, unknown> }[],
  rpcError: null as null | { message: string },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "fixture-owner" } } }) },
    rpc: async (name: string, args: Record<string, unknown>) => { db.rpc.push({ name, args }); return { data: { imported: (args.p_rows as unknown[]).length, repeat: false }, error: db.rpcError }; },
    from(table: string) {
      if (table === "profiles") {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { role: db.role, is_active: db.active }, error: null }) };
        return q;
      }
      const filters: Record<string, unknown> = {};
      let select = "";
      const q = {
        select(columns: string) { select = columns; return q; },
        in(column: string, values: unknown[]) { filters[column] = values; return q; },
        eq(column: string, value: unknown) { filters[column] = [value]; return q; },
        order() { return q; },
        // exact count + range, like PostgREST: count is the filtered total, data the requested window.
        range(from: number, to: number) {
          const all = (db.tables[table] ?? []).filter(row => Object.entries(filters).every(([c, values]) => (values as unknown[]).includes(row[c])));
          db.reads.push({ table, select, from, to, filters: { ...filters }, ids: all.slice(from, to + 1).map(row => row.id) });
          return Promise.resolve({ data: all.slice(from, to + 1), count: all.length, error: null });
        },
      };
      return q;
    },
  }),
}));
import { previewPromoExcel, savePromoExcelBatch, validatePromoDraft } from "@/app/(app)/crm/promo/impor/actions";
import ExcelJS from "exceljs";
import { makePromoExcelTemplate } from "@/lib/promo-excel";

const KEY = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const r = (line: number, code: string, unit: string, kind: string, value: string, extra: Row = {}) =>
  ({ line, code, unit, discount_type: kind, discount_value: value, ...extra });

beforeEach(() => {
  db.role = "OWNER"; db.active = true; db.reads = []; db.rpc = []; db.rpcError = null;
  db.tables = {
    items: [
      { id: "i1", code: "FIKTIF-1", name: "Barang Fiktif Satu", unit: "1/2KG", is_active: true, item_type: "Persediaan", sell_price: "20000.00", buy_price: "10000.00" },
      { id: "i2", code: "FIKTIF-2", name: "Barang Fiktif Dua", unit: "400gr", is_active: true, item_type: "Persediaan", sell_price: "30000.00", buy_price: "15000.00" },
    ],
    item_units: [{ id: "u1", item_id: "i1", unit: "KG", sell_price: "38000.00", buy_price: "19000.00" }],
    item_branch_prices: [],
    item_price_tiers: [],
    branches: [{ id: A, name: "Cabang A", is_active: true }, { id: B, name: "Cabang B", is_active: true }, { id: "c", name: "Tutup", is_active: false }],
  };
});

const scope = { allBranches: false, branchIds: [A] };
const submission = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  key: KEY, name: "Promo November", validFrom: "2099-01-01", validUntil: "2099-01-31", allBranches: false, branchIds: [A], rows, ...over,
}) as never;

it("preview via validatePromoDraft returns normal price, final price, potongan and percent for each Harga Akhir row", async () => {
  const result = await validatePromoDraft([r(2, "FIKTIF-1", "KG", "Harga Akhir", "36000"), r(3, "FIKTIF-2", "400gr", "Persen", "10")] as never, scope);
  expect(result.valid).toBe(true);
  expect(result.rows[0]).toMatchObject({ item_name: "Barang Fiktif Satu", unit: "KG", normal_price: 38000, final_price: 36000, potongan: 2000, percent_off: 5.26, error: null });
  expect(result.rows[1]).toMatchObject({ normal_price: null, potongan: null });
});

it("reads with exact count and ranges, in 150-sized chunks, only reading price tables when a Harga Akhir row exists", async () => {
  await validatePromoDraft([r(2, "FIKTIF-2", "400gr", "Persen", "10")] as never, scope);
  expect(db.reads.map(read => read.table).sort()).toEqual(["item_units", "items"]);
  db.reads = [];
  await validatePromoDraft([r(2, "FIKTIF-2", "400gr", "Harga Akhir", "27000")] as never, { allBranches: true, branchIds: [] });
  const tables = db.reads.map(read => read.table);
  expect(tables).toEqual(expect.arrayContaining(["items", "item_units", "item_branch_prices", "item_price_tiers", "branches"]));
  const prices = db.reads.find(read => read.table === "item_branch_prices")!;
  expect(prices).toMatchObject({ from: 0, to: 499, filters: { item_id: ["i2"], branch_id: [A, B] } });
  expect(db.reads.find(read => read.table === "branches")!.filters).toEqual({ is_active: [true] });
});

it("paginates a large item_branch_prices read completely (exact count, no truncation)", async () => {
  db.tables.item_branch_prices = Array.from({ length: 1200 }, (_, index) => ({ id: `p${index}`, item_id: "i2", branch_id: index % 2 ? A : B, unit: index < 1199 ? "OTHER" : "400gr", sell_price: "30000.00" }));
  const result = await validatePromoDraft([r(2, "FIKTIF-2", "400gr", "Harga Akhir", "27000")] as never, { allBranches: true, branchIds: [] });
  expect(db.reads.filter(read => read.table === "item_branch_prices").map(read => [read.from, read.to])).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  // the single matching override (branch B, 30000) equals central, so still valid
  expect(result.valid).toBe(true);
});

it("chunks item_branch_prices and item_price_tiers so URLs stay short, without dropping or duplicating rows", async () => {
  const N = 130;
  db.tables.items = Array.from({ length: N }, (_, k) => ({ id: `it${k}`, code: `FIKTIF-${k}`, name: `Barang ${k}`, unit: "PCS", is_active: true, item_type: "Persediaan", sell_price: "30000.00", buy_price: "100.00" }));
  db.tables.item_units = [];
  const branchIds = Array.from({ length: N }, (_, k) => `branch-${k}`);
  db.tables.branches = branchIds.map((id, k) => ({ id, name: `Cabang ${k}`, is_active: true }));
  // diagonal overrides (item k only differs at branch k): a dropped chunk would make that row look valid
  db.tables.item_branch_prices = Array.from({ length: N }, (_, k) => ({ id: `p${k}`, item_id: `it${k}`, branch_id: branchIds[k], unit: "PCS", sell_price: "31000.00" }));
  db.tables.item_price_tiers = [{ id: "t7", item_id: "it7" }, { id: "t120", item_id: "it120" }];
  const rows = Array.from({ length: N }, (_, k) => r(k + 2, `FIKTIF-${k}`, "PCS", "Harga Akhir", "27000"));
  const result = await validatePromoDraft(rows as never, { allBranches: true, branchIds: [] });
  const priceReads = db.reads.filter(read => read.table === "item_branch_prices");
  for (const read of priceReads) {
    expect((read.filters.item_id as string[]).length).toBeLessThanOrEqual(50);
    expect((read.filters.branch_id as string[]).length).toBeLessThanOrEqual(50);
  }
  expect(priceReads).toHaveLength(9); // 3 item chunks x 3 branch chunks
  // every override returned exactly once
  expect(priceReads.flatMap(read => read.ids).sort()).toEqual(Array.from({ length: N }, (_, k) => `p${k}`).sort());
  // price differs across branches for EVERY row -> none was silently priced from fewer branches
  expect(result.rows.every(row => /berbeda antar cabang/.test(row.error ?? ""))).toBe(true);
  const tierReads = db.reads.filter(read => read.table === "item_price_tiers");
  expect(tierReads.every(read => (read.filters.item_id as string[]).length <= 50)).toBe(true);
  expect(tierReads.flatMap(read => read.ids).sort()).toEqual(["t120", "t7"]);
  expect(result.rows[7].error).toMatch(/bertingkat|berbeda antar cabang/);
});

it("rejects a row whose unit price differs between the selected branches", async () => {
  db.tables.item_branch_prices = [{ id: "p1", item_id: "i2", branch_id: B, unit: "400gr", sell_price: "31000.00" }];
  const result = await validatePromoDraft([r(2, "FIKTIF-2", "400gr", "Harga Akhir", "27000")] as never, { allBranches: false, branchIds: [A, B] });
  expect(result.valid).toBe(false);
  expect(result.rows[0].error).toMatch(/berbeda antar cabang.*Cabang A.*Cabang B/);
});

it("requires branch scope for Harga Akhir rows, but not for Persen/Nominal", async () => {
  const none = await validatePromoDraft([r(2, "FIKTIF-2", "400gr", "Harga Akhir", "27000"), r(3, "FIKTIF-1", "1/2KG", "Nominal", "100")] as never);
  expect(none.rows[0].error).toMatch(/Pilih cabang/);
  expect(none.rows[1].error).toBeNull();
});

it("refuses a selected branch that is missing or inactive instead of pricing against fewer branches", async () => {
  const result = await validatePromoDraft([r(2, "FIKTIF-2", "400gr", "Harga Akhir", "27000")] as never, { allBranches: false, branchIds: [A, "c"] });
  expect(result.valid).toBe(false);
  expect(result.error).toMatch(/Cabang/);
});

it("saves the converted nominal discount through the unchanged RPC when the reviewed normal price still matches", async () => {
  const reviewed = await validatePromoDraft([r(2, "FIKTIF-1", "KG", "Harga Akhir", "36000"), r(3, "FIKTIF-2", "400gr", "Persen", "10")] as never, scope);
  const result = await savePromoExcelBatch(submission(reviewed.rows));
  expect(result).toMatchObject({ ok: true });
  expect(db.rpc).toEqual([{ name: "import_promo_excel_batch", args: {
    p_key: KEY,
    p_batch: { name: "Promo November", valid_from: "2099-01-01", valid_until: "2099-01-31", all_branches: false, branch_ids: [A] },
    p_rows: [
      { code: "FIKTIF-1", unit: "KG", discount_type: "nominal", discount_value: 2000 },
      { code: "FIKTIF-2", unit: "400gr", discount_type: "percent", discount_value: 10 },
    ],
  } }]);
});

it("refuses 'Harga normal berubah, validasi ulang' when the price was edited between preview and save", async () => {
  const reviewed = await validatePromoDraft([r(2, "FIKTIF-1", "KG", "Harga Akhir", "36000")] as never, scope);
  db.tables.item_units[0].sell_price = "40000.00";
  const result = await savePromoExcelBatch(submission(reviewed.rows));
  expect(result).toEqual({ ok: false, message: "Harga normal berubah, validasi ulang" });
  expect(db.rpc).toEqual([]);
});

it("refuses when a branch override edit changes the price between preview and save", async () => {
  const reviewed = await validatePromoDraft([r(2, "FIKTIF-2", "400gr", "Harga Akhir", "27000")] as never, scope);
  db.tables.item_branch_prices = [{ id: "p1", item_id: "i2", branch_id: A, unit: "400gr", sell_price: "29000.00" }];
  expect(await savePromoExcelBatch(submission(reviewed.rows))).toEqual({ ok: false, message: "Harga normal berubah, validasi ulang" });
  expect(db.rpc).toEqual([]);
});

it("refuses a Harga Akhir row submitted without a reviewed normal price (never trusts raw value alone)", async () => {
  const result = await savePromoExcelBatch(submission([r(2, "FIKTIF-1", "KG", "Harga Akhir", "36000")]));
  expect(result.ok).toBe(false);
  expect(result.message).toMatch(/validasi ulang/i);
  expect(db.rpc).toEqual([]);
});

it("refuses a forged reviewed normal price", async () => {
  const result = await savePromoExcelBatch(submission([r(2, "FIKTIF-1", "KG", "Harga Akhir", "36000", { normal_price: 99999 })]));
  expect(result).toEqual({ ok: false, message: "Harga normal berubah, validasi ulang" });
  expect(db.rpc).toEqual([]);
});

it("does not call the RPC when a Harga Akhir row is invalid (all-or-nothing)", async () => {
  const reviewed = await validatePromoDraft([r(2, "FIKTIF-1", "KG", "Harga Akhir", "36000"), r(3, "FIKTIF-2", "400gr", "Harga Akhir", "30000")] as never, scope);
  expect(reviewed.valid).toBe(false);
  const result = await savePromoExcelBatch(submission(reviewed.rows));
  expect(result.ok).toBe(false);
  expect(db.rpc).toEqual([]);
});

it("keeps Persen/Nominal-only saves working without any price reads", async () => {
  const rows = [r(2, "FIKTIF-1", "1/2KG", "Persen", "10"), r(3, "FIKTIF-1", "KG", "Nominal", "5000")];
  expect(await savePromoExcelBatch(submission(rows))).toMatchObject({ ok: true });
  expect(db.reads.map(read => read.table)).not.toContain("item_branch_prices");
  expect((db.rpc[0].args.p_rows as unknown[])).toEqual([
    { code: "FIKTIF-1", unit: "1/2KG", discount_type: "percent", discount_value: 10 },
    { code: "FIKTIF-1", unit: "KG", discount_type: "nominal", discount_value: 5000 },
  ]);
});

it("still blocks non Owner/Admin users", async () => {
  db.role = "KASIR";
  const result = await validatePromoDraft([r(2, "FIKTIF-1", "KG", "Harga Akhir", "36000")] as never, scope);
  expect(result).toMatchObject({ valid: false, error: "Hanya Owner/Admin aktif yang boleh mengimpor promo." });
  expect(db.reads).toEqual([]);
});

it("previewPromoExcel reads the Excel file and the branch scope from the form", async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await makePromoExcelTemplate()) as never);
  book.getWorksheet("Promo")!.addRow(["FIKTIF-1", "KG", "Harga Akhir", 36000]);
  const form = new FormData();
  form.set("file", new File([await book.xlsx.writeBuffer() as ArrayBuffer], "promo.xlsx"));
  form.append("branchId", A);
  const result = await previewPromoExcel(form);
  expect(result.error).toBeUndefined();
  expect(result.rows[0]).toMatchObject({ normal_price: 38000, potongan: 2000, error: null });
});

const WARNING = "HPP master belum terisi; harga akhir belum bisa dicek terhadap modal. Kasir petshop dan klinik menolak penjualan di bawah HPP FIFO; transaksi back office (/pos/transaksi) hanya memberi peringatan yang bisa dikonfirmasi (tanpa peringatan bila HPP FIFO tidak terbaca).";
const zeroCostItems = () => [
  { id: "z1", code: "100656", name: "Accesoris Bazar", unit: "PCS", is_active: true, item_type: "Persediaan", sell_price: "10000.00", buy_price: "0.00" },
  { id: "z2", code: "APL0001", name: "Apolo House", unit: "PCS", is_active: true, item_type: "Persediaan", sell_price: "10000.00", buy_price: "0.00" },
  { id: "z3", code: "100860", name: "Botol Minum 125ml", unit: "PCS", is_active: true, item_type: "Persediaan", sell_price: "20000.00", buy_price: "0.00" },
  { id: "z4", code: "CRACC0005", name: "Chiro Plate 11", unit: "PCS", is_active: true, item_type: "Persediaan", sell_price: "25000.00", buy_price: "0.00" },
  { id: "z5", code: "COSTED-1", name: "Barang Bermodal", unit: "PCS", is_active: true, item_type: "Persediaan", sell_price: "10000.00", buy_price: "8000.00" },
];
const zeroRows = () => [r(2, "100656", "PCS", "Harga Akhir", "7000"), r(3, "APL0001", "PCS", "Harga Akhir", "7000"), r(4, "100860", "PCS", "Harga Akhir", "14000"), r(5, "CRACC0005", "PCS", "Harga Akhir", "18000")];

it("zero master cost: preview rows are valid with the warning and the response counts them", async () => {
  db.tables.items = zeroCostItems(); db.tables.item_units = [];
  const result = await validatePromoDraft(zeroRows() as never, scope);
  expect(result.valid).toBe(true);
  expect(result.rows.map(row => row.error)).toEqual([null, null, null, null]);
  expect(result.rows.map(row => row.warning)).toEqual(Array(4).fill(WARNING));
  expect(result.warningCount).toBe(4);
});

it("save is allowed for a warning-only batch, the RPC gets plain nominal rows, and the result reports the warning count", async () => {
  db.tables.items = zeroCostItems(); db.tables.item_units = [];
  const reviewed = await validatePromoDraft(zeroRows() as never, scope);
  const result = await savePromoExcelBatch(submission(reviewed.rows));
  expect(result).toMatchObject({ ok: true, warningCount: 4 });
  expect(result.message).toContain("4 baris tanpa HPP master");
  expect(result.message).toContain("Kasir petshop dan klinik menolak penjualan di bawah HPP FIFO");
  expect(result.message).not.toMatch(/kasir tetap menolak/i);
  expect(db.rpc).toHaveLength(1);
  expect(db.rpc[0].args.p_rows).toEqual([
    { code: "100656", unit: "PCS", discount_type: "nominal", discount_value: 3000 },
    { code: "APL0001", unit: "PCS", discount_type: "nominal", discount_value: 3000 },
    { code: "100860", unit: "PCS", discount_type: "nominal", discount_value: 6000 },
    { code: "CRACC0005", unit: "PCS", discount_type: "nominal", discount_value: 7000 },
  ]);
});

it("save never trusts a client-provided warning: it is re-derived from the master (forged/absent/extra flags)", async () => {
  db.tables.items = zeroCostItems(); db.tables.item_units = [];
  const reviewed = await validatePromoDraft([...zeroRows(), r(6, "COSTED-1", "PCS", "Harga Akhir", "9000")] as never, scope);
  // client strips every warning and invents one on the costed row
  const forged = reviewed.rows.map((row, index) => ({ ...row, warning: index === 4 ? WARNING : null, warningCount: 99 }));
  const result = await savePromoExcelBatch(submission(forged));
  expect(result).toMatchObject({ ok: true, warningCount: 4 });
  expect(result.message).toContain("4 baris tanpa HPP master");
  expect(result.message).not.toContain("99");
});

it("a client cannot turn a below-cost row (buy 8000, final 7000) into a warning: still rejected, RPC not called", async () => {
  db.tables.items = zeroCostItems(); db.tables.item_units = [];
  const rows = [r(2, "COSTED-1", "PCS", "Harga Akhir", "7000", { normal_price: 10000, warning: WARNING, error: null })];
  const review = await validatePromoDraft(rows as never, scope);
  expect(review.valid).toBe(false);
  expect(review.rows[0].error).toMatch(/di bawah.*HPP/i);
  expect(review.rows[0].warning || null).toBeNull();
  expect(await savePromoExcelBatch(submission(rows))).toMatchObject({ ok: false });
  expect(db.rpc).toEqual([]);
});

it("Grup and unknown item type stay rejected even with zero cost", async () => {
  db.tables.items = [
    { id: "g", code: "GRP", name: "Paket", unit: "PCS", is_active: true, item_type: "Grup", sell_price: "10000.00", buy_price: "0.00" },
    { id: "n", code: "NOTYPE", name: "Tanpa Jenis", unit: "PCS", is_active: true, item_type: null, sell_price: "10000.00", buy_price: "0.00" },
  ];
  db.tables.item_units = [];
  const result = await validatePromoDraft([r(2, "GRP", "PCS", "Harga Akhir", "9000"), r(3, "NOTYPE", "PCS", "Harga Akhir", "9000")] as never, scope);
  expect(result.valid).toBe(false);
  expect(result.rows[0].error).toMatch(/paket/i);
  expect(result.rows[1].error).toMatch(/tidak terbaca/i);
  expect(result.warningCount).toBe(0);
});

it("a save without warnings keeps the original message", async () => {
  const reviewed = await validatePromoDraft([r(2, "FIKTIF-1", "KG", "Harga Akhir", "36000")] as never, scope);
  const result = await savePromoExcelBatch(submission(reviewed.rows));
  expect(result.message).toBe("1 promo berhasil disimpan.");
  expect(result.warningCount || 0).toBe(0);
});

const derivedItems = () => [
  { id: "d1", code: "DER-1", name: "Barang Turunan", unit: "PCS", is_active: true, item_type: "Persediaan", sell_price: "20000.00", buy_price: "5000.00" },
  { id: "d3", code: "DER-2", name: "Barang Turunan Dua", unit: "PCS", is_active: true, item_type: "Persediaan", sell_price: "20000.00", buy_price: "5000.00" },
  { id: "d2", code: "DER-0", name: "Barang Tanpa Modal", unit: "PCS", is_active: true, item_type: "Persediaan", sell_price: "20000.00", buy_price: "0.00" },
];
const derivedUnits = () => [
  { id: "du1", item_id: "d1", unit: "DUS", sell_price: "240000.00", buy_price: "0.00", factor: "12.0000" },
  { id: "du3", item_id: "d3", unit: "DUS", sell_price: "240000.00", buy_price: "0.00", factor: "12.0000" },
  { id: "du2", item_id: "d2", unit: "DUS", sell_price: "240000.00", buy_price: "0.00", factor: "12.0000" },
];

it("derived unit with own buy 0 but base buy 5000 x factor 12: reads the factor and rejects final below 60000, warns only when nothing is known", async () => {
  db.tables.items = derivedItems(); db.tables.item_units = derivedUnits();
  const result = await validatePromoDraft([r(2, "DER-1", "DUS", "Harga Akhir", "1000"), r(3, "DER-2", "DUS", "Harga Akhir", "60000"), r(4, "DER-0", "DUS", "Harga Akhir", "1000")] as never, scope);
  expect(result.rows[0].error).toMatch(/di bawah.*HPP/i);
  expect(result.rows[1]).toMatchObject({ error: null, warning: null });
  expect(result.rows[2]).toMatchObject({ error: null, warning: WARNING });
  const unitReads = db.reads.filter(read => read.table === "item_units");
  expect(unitReads.length).toBeGreaterThan(0);
  for (const read of unitReads) expect(read.select).toMatch(/\bfactor\b/);
});
