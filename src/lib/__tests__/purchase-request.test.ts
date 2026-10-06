import { describe, expect, it } from "vitest";
import { createPurchaseRequestStore } from "../purchase-request";
function fixture() {
 const values = new Map<string,string>();let sequence=0;
 const storage = { getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);} };
 return {values,storage,random:()=>`key-${++sequence}`};
}
describe("purchase submission identity",()=>{
 it("retains the key when the form is remounted after a lost response",()=>{
  const f=fixture();const first=createPurchaseRequestStore("receipt:po-1",()=>f.storage,f.random);
  first.subscribe(()=>{});const key=first.getSnapshot().key;
  const refreshed=createPurchaseRequestStore("receipt:po-1",()=>f.storage,f.random);refreshed.subscribe(()=>{});
  expect(refreshed.getSnapshot()).toEqual({key,previous:true});
 });
 it("rotates the current mounted form only when its own key is confirmed",()=>{
  const f=fixture();const store=createPurchaseRequestStore("asset",()=>f.storage,f.random);let changed=0;
  store.subscribe(()=>{changed++;});const original=store.getSnapshot().key;
  store.confirm("unrelated-key");expect(store.getSnapshot().key).toBe(original);
  store.confirm(original);expect(store.getSnapshot().key).not.toBe(original);expect(store.getSnapshot().previous).toBe(false);expect(changed).toBe(2);
 });
 it("keeps different PO and operation forms independent",()=>{
  const f=fixture();const a=createPurchaseRequestStore("receipt:one",()=>f.storage,f.random);const b=createPurchaseRequestStore("invoice",()=>f.storage,f.random);
  a.subscribe(()=>{});b.subscribe(()=>{});const key=b.getSnapshot().key;a.confirm(a.getSnapshot().key);
  expect(b.getSnapshot().key).toBe(key);
 });
 it("keeps the mounted key stable when browser storage is unavailable",()=>{
  const store=createPurchaseRequestStore("asset",()=>{throw new Error("blocked");},()=>"memory-key");store.subscribe(()=>{});store.subscribe(()=>{});
  expect(store.getSnapshot().key).toBe("memory-key");expect(store.getServerSnapshot().key).toBe("");
 });
});
