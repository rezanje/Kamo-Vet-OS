import { describe, expect, it } from "vitest";
import { lifecycleInput, masterReturn, masterView, visibleMasters } from "../master-lifecycle";
const id = "11111111-1111-4111-8111-111111111111";
function form(extra: Record<string,string> = {}) {
  const data = new FormData();
  for (const [k,v] of Object.entries({entity:"items",id,revision:"3",action:"trash",reason:"Keliru input",...extra})) data.set(k,v);
  return data;
}
describe("recoverable master lifecycle", () => {
  it("requires a known entity, explicit revision, row, action and meaningful reason", () => {
    expect(lifecycleInput(form())).toMatchObject({entity:"items",id,revision:3,reason:"Keliru input"});
    for (const extra of ([{entity:"profiles"},{entity:"__proto__"},{id:"missing"},{action:"delete"},{revision:""},{revision:"-1"},{revision:"Infinity"},{reason:" "},{reason:"a".repeat(501)}] as Record<string,string>[])) expect(()=>lifecycleInput(form(extra))).toThrow();
  });
  it("keeps trashed rows separate and preserves inactive rows for recovery", () => {
    const rows=[{id:1,active:true},{id:2,active:false},{id:3,active:false,trashed_at:"now"}];
    expect(visibleMasters(rows,"all",r=>r.active).map(r=>r.id)).toEqual([1,2]);
    expect(visibleMasters(rows,"active",r=>r.active).map(r=>r.id)).toEqual([1]);
    expect(visibleMasters(rows,"inactive",r=>r.active).map(r=>r.id)).toEqual([2]);
    expect(visibleMasters(rows,"trash",r=>r.active).map(r=>r.id)).toEqual([3]);
  });
  it("normalizes unknown views and keeps recognized ones", () => {
    expect(masterView("delete")).toBe("all");expect(masterView("trash")).toBe("trash");
  });
  it("returns only to the fixed entity route while preserving search, category and pagination", () => {
    expect(masterReturn("items","cari=kucing&induk=a&kat=b&jenis=Jasa&hal=3&view=inactive&edit=id&redirect=https://evil.invalid")).toBe("/pos/sku?view=inactive&cari=kucing&kat=b&induk=a&jenis=Jasa&hal=3");
    expect(masterReturn("suppliers","view=trash&tab=other")).toBe("/pembelian?tab=supplier&view=trash");
  });
});
