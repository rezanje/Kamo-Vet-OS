import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ hash: "", rpcCalls: [] as string[], blocked: [] as string[], rpcFailure: false, rpcFailureId: "", failItem: false, failCode: "", failUnits: false, missingRead: false, summary: {} as Record<string, unknown>, runStatus: "previewed", audit: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[], categories: [] as Record<string, unknown>[] }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  async rpc(_name: string, { p_category_id: id }: { p_category_id: string }) {
    state.rpcCalls.push(id);
    if (state.rpcFailure || state.rpcFailureId === id) return { error: { code: "XX000", message: "cleanup unavailable" } };
    if (state.items.some(row => row.category_id === id) || state.categories.some(row => row.parent_id === id) || state.blocked.includes(id)) {
      return { error: { code: "23503", message: "still referenced" } };
    }
    state.categories = state.categories.filter(row => row.id !== id);
    return { error: null };
  },
  from(table: string) {
    let operation = "select";
    let payload: Record<string, unknown>[] = [];
    const filters = new Map<string, unknown>();
    function result(single = false) {
      let data: Record<string, unknown>[] = [];
      if (table === "item_units" && operation === "delete" && state.failUnits) return { data: null, error: { message: "unit delete failed" } };
      if (table === "profiles") data = [{ role: "OWNER" }];
      if (table === "import_runs") data = [{ id: "run", kind: "master_accurate", source_hash: state.hash, status: state.runStatus, summary: state.summary }];
      if (table === "units") data = [{ id: "unit", nama: "PCS" }];
      if (table === "item_categories") data = state.categories;
      if (table === "import_run_rows") data = state.audit;
      if (table === "items") data = state.items.map(item => ({ ...item,
        category: state.categories.find(category => category.id === item.category_id), units: [] }));
      if (operation === "select" && table === "items" && filters.has("id") && state.missingRead) data = [];
      if (operation === "insert" && table === "item_categories") {
        data = payload.map(row => ({ ...row, id: `category-${state.categories.length}` })); state.categories.push(...data);
      }
      if (operation === "update" && table === "item_categories") {
        state.categories.filter(row => row.id === filters.get("id")).forEach(row => Object.assign(row, payload[0]));
      }
      if (operation === "update" && table === "import_run_rows") {
        state.audit.filter(row => [...filters].every(([key,value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)).forEach(row => Object.assign(row,payload[0]));
      }
      if (operation === "update" && table === "import_runs") state.summary = payload[0].summary as Record<string, unknown>;
      if (operation === "upsert" && table === "items") {
        if (state.failItem || payload.some(row => row.code === state.failCode)) return { data: null, error: { message: "save failed" } };
        data = payload.map(row => {
          const existing = state.items.find(item => item.id === row.id);
          if (existing) { Object.assign(existing, row); return existing; }
          const created = { ...row, id: `item-${state.items.length}` }; state.items.push(created); return created;
        });
      }
      return { data: single ? data[0] ?? null : data, error: null };
    }
    const query = {
      select: () => query, order: () => query, limit: () => query, range: () => query,
      in: (key:string,values:unknown[]) => { filters.set(key,values);return query; },
      eq: (key: string, value: unknown) => { filters.set(key, value); return query; },
      update: (row: Record<string, unknown>) => { operation = "update"; payload = [row]; return query; },
      insert: (row: Record<string, unknown>) => { operation = "insert"; payload = [row]; return query; },
      upsert: (rows: Record<string, unknown>[]) => { operation = "upsert"; payload = rows; return query; },
      delete: () => { operation = "delete"; return query; },
      maybeSingle: async () => result(true), single: async () => result(true),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  },
}) }));
import { konfirmasiImporAccurate, previewImporAccurate } from "../../app/(app)/pos/sku/impor/actions";
beforeEach(() => {
  state.rpcCalls = []; state.blocked = []; state.rpcFailure = false; state.rpcFailureId = ""; state.failItem = false; state.failCode = ""; state.failUnits = false; state.missingRead = false; state.summary = {};
  state.runStatus = "previewed";
  state.audit = [];
  state.categories = [
    { id: "old", name: "LAMA", parent_id: null }, { id: "new", name: "BARU", parent_id: null },
  ];
  state.items = [{ id: "existing", code: " A-1 ", name: "Barang", item_type: "Persediaan", category_id: "old", unit: "PCS", is_active: true }];
});
it("clears a previous rejection in the audit when that row succeeds during replay",async()=>{
 const form=await input([["A-1","Barang","INV","BARU","","PCS"]]);
 state.runStatus="posted";
 state.audit=[{id:1,run_id:"run",source_row:2,source_code:"A-1",status:"rejected",reason:"Gagal lama"}];
 expect((await konfirmasiImporAccurate(form)).ok).toBe(true);
 expect(state.audit[0]).toMatchObject({status:"posted",reason:null});
});
it("preserves a skipped duplicate's audit status when the retained row is posted",async()=>{
 const form=await input([["A-1","Barang","INV","BARU","","PCS"],["A-1","Barang","INV","BARU","","PCS"]]);
 state.audit=[{id:1,run_id:"run",source_row:2,source_code:"A-1",status:"valid",reason:null},{id:2,run_id:"run",source_row:3,source_code:"A-1",status:"skipped",reason:"Duplikat sama"}];
 expect((await konfirmasiImporAccurate(form)).ok).toBe(true);
 expect(state.audit[0].status).toBe("posted");
 expect(state.audit[1]).toMatchObject({status:"skipped",reason:"Kode kembar dengan isi sama"});
});
it("keeps a rejected row from another file distinct from a valid code at the same row number",async()=>{
 const form=await input([["A-1","Barang","INV","BARU","","PCS"]],[["A-1","Barang","INV","BARU","",""]]);
 state.audit=[{id:1,run_id:"run",source_row:2,source_code:"A-1",status:"valid",reason:null,payload:{source:"items.xlsx:2"}},{id:2,run_id:"run",source_row:2,source_code:"A-1",status:"rejected",reason:"Satuan kosong",payload:{source:"other.xlsx:2"}}];
 const result=await konfirmasiImporAccurate(form);
 expect(result.ok).toBe(true);
 expect(result.summary.Ditolak).toBe(1);
 expect(state.audit[0].status).toBe("posted");
 expect(state.audit[1].status).toBe("rejected");
});
it("preserves ambiguous legacy audit rows that have no filename",async()=>{
 const form=await input([["A-1","Barang","INV","BARU","","PCS"]],[["A-1","Barang","INV","BARU","",""]]);
 state.audit=[{id:1,run_id:"run",source_row:2,source_code:"A-1",status:"valid",reason:null},{id:2,run_id:"run",source_row:2,source_code:"A-1",status:"rejected",reason:"Satuan kosong"}];
 expect((await konfirmasiImporAccurate(form)).ok).toBe(true);
 expect(state.audit[0].status).toBe("valid");
 expect(state.audit[1]).toMatchObject({status:"rejected",reason:"Satuan kosong"});
});
async function input(rows: unknown[][], extraRows?: unknown[][]) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Barang & Jasa");
  ws.addRow(["Kode Barang", "Nama Barang", "Jenis Barang", "Kategori Barang", "Subkategori", "Satuan"]);
  rows.forEach(row => ws.addRow(row));
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  const form = new FormData(); form.append("files", new File([bytes], "items.xlsx"));
  const hash = createHash("sha256").update("items.xlsx").update("\0").update(String(bytes.length)).update("\0").update(bytes);
  if (extraRows) {
    const other = new ExcelJS.Workbook(); const sheet = other.addWorksheet("Barang & Jasa");
    sheet.addRow(["Kode Barang", "Nama Barang", "Jenis Barang", "Kategori Barang", "Subkategori", "Satuan"]);
    extraRows.forEach(row => sheet.addRow(row));
    const extra = Buffer.from(await other.xlsx.writeBuffer());
    form.append("files", new File([extra], "other.xlsx"));
    hash.update("other.xlsx").update("\0").update(String(extra.length)).update("\0").update(extra);
  }
  state.hash = hash.digest("hex"); form.set("run_id", "run"); return form;
}
it("changes the category on the existing item even when its stored code has spaces", async () => {
  const result = await konfirmasiImporAccurate(await input([["A-1", "Barang", "INV", "BARU", "", "PCS"]]));
  expect(result.ok).toBe(true);
  expect(result.summary.Update).toBe(1);
  expect(state.items).toHaveLength(1);
  expect(state.items[0]).toMatchObject({ id: "existing", category_id: "new" });
});
it("reuses existing categories across a file with repeated child names", async () => {
  state.items[0].code = "A-1";
  state.categories = [
    { id: "old", name: "LAMA", parent_id: null },
    { id: "p1", name: "ACCESORIS", parent_id: null },
    { id: "p2", name: "ALKES", parent_id: null },
    { id: "c1", name: "COLLAR", parent_id: "p1" },
  ];
  const result = await konfirmasiImporAccurate(await input([
    ["A-1", "Barang", "INV", "ACCESORIS", "COLLAR", "PCS"],
    ["A-2", "Barang B", "INV", "ALKES", "COLLAR", "PCS"],
  ]));
  expect(result.ok).toBe(true);
  expect(state.items.find(row => row.id === "existing")?.category_id).toBe("c1");
  expect(state.categories.map(row => row.name)).not.toContain("COLLAR — ACCESORIS");
});

it("keeps item destinations correct when repeated child names are uploaded in two files", async () => {
  state.items[0].code = "A-1";
  state.categories = [
    { id: "old", name: "LAMA", parent_id: null },
    { id: "p1", name: "ACCESORIS", parent_id: null },
    { id: "p2", name: "ALKES", parent_id: null },
    { id: "c1", name: "COLLAR", parent_id: "p1" },
    { id: "c2", name: "COLLAR — ALKES", parent_id: "p2" },
  ];
  const result = await konfirmasiImporAccurate(await input(
    [["A-1", "Barang", "INV", "ACCESORIS", "COLLAR", "PCS"]],
    [["A-2", "Barang B", "INV", "ALKES", "COLLAR", "PCS"]],
  ));
  expect(result.ok).toBe(true);
  expect(state.items.find(row => row.code === "A-1")?.category_id).toBe("c1");
  expect(state.items.find(row => row.code === "A-2")?.category_id).toBe("c2");
  expect(state.categories).toHaveLength(4);
  expect(state.categories.some(row => row.id === "old")).toBe(false);
});

it("replays a posted file when the existing item's category differs from that file", async () => {
 const form=await input([["A-1","Barang","INV","BARU","","PCS"]]);
 state.runStatus="posted";
 const preview=await previewImporAccurate(form);
 expect(preview.phase).toBe("preview");
 const result=await konfirmasiImporAccurate(form);
 expect(result.ok).toBe(true);
 expect(state.items).toHaveLength(1);
 expect(state.items[0].category_id).toBe("new");
});
it("reactivates an imported inactive parent so its children stay available",async()=>{
 state.categories=[{id:"old",name:"LAMA",parent_id:null,is_active:true},{id:"obat",name:"OBAT",parent_id:null,is_active:false},{id:"flu",name:"FLU",parent_id:"obat",is_active:true}];
 const result=await konfirmasiImporAccurate(await input([["A-1","Barang","INV","OBAT","FLU","PCS"]]));
 expect(result.ok).toBe(true);
 expect(state.categories.find(c=>c.id==="obat")?.is_active).toBe(true);
 expect(state.items[0].category_id).toBe("flu");
});

it("keeps an unchanged posted file complete so its initial stock is not reposted",async()=>{
 const form=await input([["A-1","Barang","INV","BARU","","PCS"]]);
 await konfirmasiImporAccurate(form);
 state.runStatus="posted";
 expect((await previewImporAccurate(form)).phase).toBe("done");
});
it("does not skip a changed row when another uploaded file has an unchanged row at the same row number",async()=>{
 const same={id:"same",code:"B",name:"Unchanged",item_type:"Persediaan",category_id:"new",unit:"PCS",sell_price:0,buy_price:0,min_stock:0,buy_unit:"PCS",min_buy:0,default_discount:0,track_expiry:false,is_active:true};
 state.items.push(same);
 const result=await konfirmasiImporAccurate(await input([["A-1","Barang","INV","BARU","","PCS"]],[["B","Unchanged","INV","BARU","","PCS"]]));
 expect(result.ok).toBe(true);
 expect(state.items[0].category_id).toBe("new");
 expect(result.total_rows).toBe(2);
 expect(result.summary.Update).toBe(1);
 expect(result.summary.Sama).toBe(1);
});

it("replaces an emptied OBAT hierarchy after importing existing products into OBAT & VITAMIN", async () => {
  state.categories = [
    { id: "old", name: "OBAT", parent_id: null },
    { id: "old-child", name: "OBAT FLU", parent_id: "old" },
    { id: "empty-child", name: "OBAT TABLET", parent_id: "old" },
    { id: "unrelated", name: "CADANGAN", parent_id: null },
  ];
  state.items[0].category_id = "old-child";
  const form = await input([["A-1", "Barang", "INV", "OBAT & VITAMIN", "FLU", "PCS"]]);
  expect((await konfirmasiImporAccurate(form)).ok).toBe(true);
  expect(state.categories.map(row => row.name).sort()).toEqual(["CADANGAN", "FLU", "OBAT & VITAMIN"]);
  const destination = state.categories.find(row => row.name === "FLU")!;
  expect(state.items).toHaveLength(1);
  expect(state.items[0].category_id).toBe(destination.id);
  expect(state.rpcCalls.indexOf("old")).toBeGreaterThan(state.rpcCalls.indexOf("old-child"));
  state.runStatus = "posted";
  expect((await konfirmasiImporAccurate(form)).ok).toBe(true);
  expect(state.categories).toHaveLength(3);
});
it("retains a partially imported hierarchy and categories used by business rules", async () => {
  state.categories = [
    { id: "old", name: "OBAT", parent_id: null },
    { id: "old-child", name: "OBAT FLU", parent_id: "old" },
    { id: "untouched", name: "TABLET", parent_id: "old" },
  ];
  state.items[0].category_id = "old-child";
  state.items.push({ ...state.items[0], id: "not-imported", code: "B", category_id: "untouched" });
  state.blocked = ["old-child"];
  expect((await konfirmasiImporAccurate(await input([["A-1", "Barang", "INV", "OBAT & VITAMIN", "FLU", "PCS"]]))).ok).toBe(true);
  expect(state.categories.filter(row => ["old", "old-child", "untouched"].includes(String(row.id)))).toHaveLength(3);
  expect(state.items.find(row => row.id === "not-imported")?.category_id).toBe("untouched");
  expect(state.rpcCalls).not.toContain("untouched");
});
it("reports cleanup failure instead of claiming the old categories were removed", async () => {
  state.rpcFailure = true;
  const result = await konfirmasiImporAccurate(await input([["A-1", "Barang", "INV", "BARU", "", "PCS"]]));
  expect(result.ok).toBe(true);
  expect(result.message).toContain("kategori lama belum berhasil dibersihkan");
  expect(state.categories.some(row => row.id === "old")).toBe(true);
});

it("finishes pending cleanup on a posted replay even after products already moved", async () => {
  const form = await input([["A-1", "Barang", "INV", "BARU", "", "PCS"]]);
  state.rpcFailure = true;
  expect((await konfirmasiImporAccurate(form)).ok).toBe(true);
  expect(state.summary.category_cleanup_ids).toEqual(["old"]);
  state.rpcFailure = false; state.runStatus = "posted";
  expect((await previewImporAccurate(form)).phase).toBe("preview");
  expect((await konfirmasiImporAccurate(form)).ok).toBe(true);
  expect(state.categories.some(row => row.id === "old")).toBe(false);
  expect(state.summary.category_cleanup_ids).toEqual([]);
});
it("keeps the old category when saving the replacement product fails", async () => {
  state.failItem = true;
  const result = await konfirmasiImporAccurate(await input([["A-1", "Barang", "INV", "BARU", "", "PCS"]]));
  expect(result.summary.Ditolak).toBe(1);
  expect(state.items[0].category_id).toBe("old");
  expect(state.categories.some(row => row.id === "old")).toBe(true);
});

it("retries ancestors when a failed child cleanup temporarily keeps its parent referenced", async () => {
  state.categories.push({ id: "child", name: "FLU LAMA", parent_id: "old" });
  state.items[0].category_id = "child";
  const form = await input([["A-1", "Barang", "INV", "BARU", "", "PCS"]]);
  state.rpcFailureId = "child";
  expect((await konfirmasiImporAccurate(form)).ok).toBe(true);
  expect(state.summary.category_cleanup_ids).toEqual(["child", "old"]);
  state.rpcFailureId = ""; state.runStatus = "posted";
  expect((await konfirmasiImporAccurate(form)).ok).toBe(true);
  expect(state.categories.map(row => row.id)).toEqual(["new"]);
});
it("does not remove empty siblings when replacement product saving fails", async () => {
  state.categories.push({ id: "child", name: "FLU LAMA", parent_id: "old" }, { id: "empty", name: "TABLET", parent_id: "old" });
  state.items[0].category_id = "child";
  const form = await input([["A-1", "Barang", "INV", "BARU", "", "PCS"]]);
  state.failItem = true;
  const result = await konfirmasiImporAccurate(form);
  expect(result.summary.Ditolak).toBe(1);
  expect(result.message).toContain("Pembersihan kategori lama ditunda");
  expect(state.categories).toHaveLength(4);
  expect(state.rpcCalls).toEqual([]);
  state.failItem = false; state.runStatus = "posted";
  expect((await konfirmasiImporAccurate(form)).ok).toBe(true);
  expect(state.categories.map(row => row.id)).toEqual(["new"]);
});

it("cleans successful branches even when another branch needs a corrected file", async () => {
  state.categories.push({ id: "other-old", name: "AKSESORIS", parent_id: null });
  state.items.push({ ...state.items[0], id: "other-item", code: "B", category_id: "other-old" });
  state.failCode = "B";
  const result = await konfirmasiImporAccurate(await input([
    ["A-1", "Barang", "INV", "BARU", "", "PCS"],
    ["B", "Barang B", "INV", "BARU", "", "PCS"],
  ]));
  expect(result.summary.Ditolak).toBe(1);
  expect(state.categories.some(row => row.id === "old")).toBe(false);
  expect(state.categories.some(row => row.id === "other-old")).toBe(true);
});
it("does not defer completed category cleanup for an unrelated invalid spreadsheet row", async () => {
  const result = await konfirmasiImporAccurate(await input([
    ["A-1", "Barang", "INV", "BARU", "", "PCS"],
    ["B", "Invalid", "INV", "BARU", "", ""],
  ]));
  expect(result.summary.Ditolak).toBe(1);
  expect(state.categories.some(row => row.id === "old")).toBe(false);
});

it("uses the persisted category when units fail after the product upsert committed", async () => {
  state.categories.push({ id: "child", name: "FLU LAMA", parent_id: "old" }, { id: "empty", name: "TABLET", parent_id: "old" });
  state.items[0].category_id = "child";
  const form = await input([["A-1", "Barang", "INV", "BARU", "", "PCS"]]);
  state.failUnits = true;
  const result = await konfirmasiImporAccurate(form);
  expect(result.summary.Ditolak).toBe(1);
  expect(state.items[0].category_id).toBe("new");
  expect(state.categories.map(row => row.id)).toEqual(["new"]);
  state.failUnits = false; state.runStatus = "posted";
  expect((await konfirmasiImporAccurate(form)).ok).toBe(true);
  expect(state.categories.map(row => row.id)).toEqual(["new"]);
});

it("preserves cleanup candidates when the persisted-category read is incomplete", async () => {
  const form = await input([["A-1", "Barang", "INV", "BARU", "", "PCS"]]);
  state.failUnits = true; state.missingRead = true;
  expect((await konfirmasiImporAccurate(form)).summary.Ditolak).toBe(1);
  expect(state.items[0].category_id).toBe("new");
  expect(state.summary.category_cleanup_ids).toEqual(["old"]);
  expect(state.categories.some(row => row.id === "old")).toBe(true);
  state.failUnits = false; state.missingRead = false; state.runStatus = "posted";
  expect((await konfirmasiImporAccurate(form)).ok).toBe(true);
  expect(state.categories.map(row => row.id)).toEqual(["new"]);
});
