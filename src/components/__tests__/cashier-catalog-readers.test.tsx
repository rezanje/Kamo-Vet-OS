import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ user: true, shift: true, branch: "allowed", status: "Dikirim", fail: "", truncate: "", reads: [] as { table: string; eq: Record<string, unknown>; from?: number }[] }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(href); } }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => state.shift ? { branch_id: "allowed", branchName: "Fictional branch" } : null }));
vi.mock("@/lib/permintaan", () => ({ loadKatalogPermintaan: async () => [{ id: "sku-1204", name: "Fictional late product", code: "LATE", unit: "box", units: [] }] }));
vi.mock("@/app/kasir/persediaan/baru/PersediaanBaruForm", () => ({ PersediaanBaruForm: ({ items }: { items: { id: string; stok: number }[] }) => <div data-stock={items[0].stok}>{items[0].id}</div> }));
vi.mock("@/app/kasir/persediaan/terima/[id]/TerimaForm", () => ({ TerimaForm: ({ items, catalog }: { items: { id: string; satuan: string; qty_disetujui: number }[]; catalog: { id: string }[] }) => <div data-lines={items.length} data-catalog={catalog.length}>{items.at(-1)?.id} {items.at(-1)?.satuan} {items.at(-1)?.qty_disetujui} {catalog.at(-1)?.id}</div> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user ? { id: "actor" } : null } }) },
  rpc: async () => ({ data: [], error: null }),
  from(table: string) {
    const read = { table, eq: {} } as { table: string; eq: Record<string, unknown>; from?: number };
    state.reads.push(read);
    let from = 0, to = 999, counted = false;
    const allRows = (): Row[] => {
      if (table === "stock_requests") return [{ id: "request", status: state.status, from_branch_id: state.branch, no_request: "REQ-FICTION", warehouses: { name: "Fictional DC" }, stock_request_items: [] }];
      if (table === "warehouses") return [{ id: "wh-allowed", branch_id: "allowed", is_active: true }];
      if (table === "stock") return [...Array.from({ length: 1205 }, (_, i) => ({ id: `stock-${i}`, item_id: `sku-${i}`, warehouse_id: "wh-allowed", qty: i === 1204 ? 44 : 1 })), { id: "foreign", item_id: "sku-1204", warehouse_id: "wh-foreign", qty: 999 }];
      if (table === "stock_request_items") return Array.from({ length: 1205 }, (_, i) => ({ id: `line-${i}`, request_id: "request", item_id: `sku-${i}`, nama: `Fiction ${i}`, qty_diminta: 9, qty_disetujui: 2, satuan: "box", catatan: "Fiction" }));
      if (table === "items") return Array.from({ length: 1205 }, (_, i) => ({ id: `sku-${i}`, name: `Fiction ${i}`, code: `F-${i}`, unit: "pcs", upc: null, item_categories: null, is_active: true }));
      return [];
    };
    const result = () => {
      const rows = allRows().filter(row => Object.entries(read.eq).every(([key, value]) => row[key] === value));
      const data = rows.slice(from, to + 1);
      if (state.truncate === table && from === 500) data.pop();
      return { data, count: counted ? rows.length : null, error: state.fail === table ? { message: "private fixture details" } : null };
    };
    const query = {
      select(_fields: string, options?: { count: string }) { counted = options?.count === "exact"; return query; },
      eq(key: string, value: unknown) { read.eq[key] = value; return query; }, order() { return query; },
      limit(size: number) { to = size - 1; return query; }, range(a: number, b: number) { from = a; to = b; read.from = a; return query; },
      maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  },
}) }));
import ReceivePage from "@/app/kasir/persediaan/terima/[id]/page";
import RequestPage from "@/app/kasir/persediaan/baru/page";
const receive = async () => renderToStaticMarkup(await ReceivePage({ params: Promise.resolve({ id: "request" }) }));
const request = async () => renderToStaticMarkup(await RequestPage({ searchParams: Promise.resolve({}) }));
beforeEach(() => { Object.assign(state, { user: true, shift: true, branch: "allowed", status: "Dikirim", fail: "", truncate: "", reads: [] }); });

it("loads every receiving child by the authorized request ID, retaining approved quantity/unit and barcode catalogue", async () => {
  const html = await receive();
  expect(html).toContain('data-lines="1205"'); expect(html).toContain("line-1204 box 2"); expect(html).toContain('data-catalog="1205"');
  expect(state.reads.filter(read => read.table === "stock_request_items").map(read => read.from)).toEqual([0, 500, 1000]);
  expect(state.reads.filter(read => read.table === "stock_request_items").every(read => read.eq.request_id === "request")).toBe(true);
});
it.each(["login", "shift", "branch", "Disetujui", "Selesai"])("retains cashier %s guard before any catalogue/child read", async mode => {
  if (mode === "login") state.user = false;
  else if (mode === "shift") state.shift = false;
  else if (mode === "branch") state.branch = "foreign";
  else state.status = mode;
  await expect(receive()).rejects.toThrow(mode === "login" ? "/login" : mode === "shift" ? "/kasir/mulai" : "/kasir/persediaan?tab=penerimaan");
  expect(state.reads.some(read => ["items", "stock_request_items"].includes(read.table))).toBe(false);
});
it.each(["stock_requests", "stock_request_items", "items"])("hides receiving form and private details on %s failure", async table => {
  state.fail = table;
  const html = await receive();
  expect(html).toContain('role="alert"'); expect(html).not.toContain("data-lines"); expect(html).not.toContain("private fixture");
});
it.each(["stock_request_items", "items"])("does not render silently truncated %s", async table => {
  state.truncate = table;
  expect(await receive()).toContain('role="alert"');
});
it("loads late stock hints only from the existing selected shift-branch warehouse", async () => {
  expect(await request()).toContain('data-stock="44"');
  const reads = state.reads.filter(read => read.table === "stock");
  expect(reads.map(read => read.from)).toEqual([0, 500, 1000]);
  expect(reads.every(read => read.eq.warehouse_id === "wh-allowed")).toBe(true);
  expect(state.reads.find(read => read.table === "warehouses")?.eq.branch_id).toBe("allowed");
});
it.each(["warehouses", "stock"])("does not claim zero stock when %s cannot be read", async table => {
  state.fail = table;
  const error = await request().then(() => null, result => result as Error);
  expect(error?.message).toMatch(/belum.*dimuat/i); expect(error?.message).not.toContain("private fixture");
});
