import { beforeEach, expect, it, vi } from "vitest";
import type { Item } from "@/app/(app)/pembelian/baru/POForm";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ props: {} as Record<string, unknown>, ranges: [] as number[][], orders: [] as string[], failLater: false,
  loadUnits: vi.fn(async (db: unknown, ids: string[]) => { void db; void ids; return new Map([["item-1204", [{ unit: "box", factor: 12, sell_price: 120, buy_price: 72 }]]]); }) }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/app/(app)/pembelian/baru/POForm", () => ({ POForm: (props: Record<string, unknown>) => { state.props = props; return <div />; } }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadItemUnits: state.loadUnits }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    const all = table === "items" ? Array.from({ length: 1205 }, (_, i) => ({ id: `item-${String(i).padStart(4,"0")}`, code: `SKU${i}`, name: i === 1204 ? "Zebra food" : `Item${String(i).padStart(4,"0")}`, unit: "pcs", sell_price: 10, buy_price: 6 })) : [];
    let from=0, to=999, counted=false;
    const query = { select: (_fields: string, options?: { count?: string }) => { counted=options?.count==="exact"; return query; },
      eq: (field: string, value: unknown) => { if(table==="items") { expect(field).toBe("is_active"); expect(value).toBe(true); } return query; },
      order: (column: string) => { if(table==="items") state.orders.push(column); return query; },
      range: (start: number, end: number) => { from=start; to=end; if(table==="items") state.ranges.push([start,end]); return query; },
      then: (resolve: (result: unknown)=>unknown) => Promise.resolve(resolve({ data: all.slice(from,to+1), count: counted ? all.length : null, error: state.failLater && table==="items" && from>=500 ? { message:"Catalog unavailable" } : null })),
    }; return query;
  },
}) }));
import BaruPOPage from "@/app/(app)/pembelian/baru/page";
beforeEach(()=>{state.props={};state.ranges=[];state.orders=[];state.failLater=false;state.loadUnits.mockClear();});
it("passes the complete active catalog and later items' purchase units to PO", async()=>{
  renderToStaticMarkup(await BaruPOPage({ searchParams: Promise.resolve({}) }));
  expect(state.props.items).toHaveLength(1205);
  expect((state.props.items as Item[]).at(-1)).toMatchObject({ id:"item-1204", code:"SKU1204", name:"Zebra food", buy_price:6, units:[{unit:"pcs",factor:1,buy_price:6},{unit:"box",factor:12,buy_price:72}] });
  expect(state.loadUnits.mock.calls[0][1]).toHaveLength(1205);
  expect(state.ranges).toEqual([[0,499],[500,999],[1000,1499]]);
  expect(state.orders).toEqual(["name","id","name","id","name","id"]);
});
it("never renders a partial PO catalog when a later page fails", async()=>{
  state.failLater=true;
  await expect(BaruPOPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/belum dapat dimuat lengkap/);
  expect(state.loadUnits).not.toHaveBeenCalled();
});
