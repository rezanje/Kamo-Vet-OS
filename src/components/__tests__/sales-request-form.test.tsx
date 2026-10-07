// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({rpc:vi.fn(), shipped:10,billed:5}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error(url);},notFound:()=>{throw new Error("not found");}}));
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement("a",props,children)}));
vi.mock("@/lib/master-guard",()=>({assertRole:async()=>({rpc:state.rpc}),bolehTransaksiKas:async()=>true}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:"owner"}}})},from:(table:string)=>{
  const data=table==="sales_orders"?{id:"00000000-0000-4000-8000-000000000001",no_pesanan:"SO.TEST",status:"diproses",total:200,warehouse_id:null,sales_order_items:[{id:"00000000-0000-4000-8000-000000000002",nama:"Test pcs",satuan:"pcs",qty:20,harga:10,qty_kirim:state.shipped,qty_faktur:state.billed}]}:[];
  const query={select:()=>query,eq:()=>query,order:()=>query,maybeSingle:async()=>({data}),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data}).then(resolve)};
  return query;
}})}));
import DetailPesananPage from "../../app/(app)/penjualan/pesanan/[id]/page";
import {buatPengiriman,recoverSalesSubmission} from "../../app/(app)/penjualan/pesanan/actions";
let container:HTMLDivElement;let root:Root;
beforeEach(()=>{
  state.shipped=10;state.billed=5;state.rpc.mockReset();sessionStorage.clear();
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  container=document.createElement("div");document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
async function render(params:{error?:string;request_done?:string;request_scope?:string}={}){
  const tree=await DetailPesananPage({params:Promise.resolve({id:"00000000-0000-4000-8000-000000000001"}),searchParams:Promise.resolve(params)});
  await act(async()=>{root.render(tree);});
}
const shipmentForm=()=>Array.from(container.querySelectorAll("form")).find(f=>f.textContent?.includes("Catat pengiriman"))!;
const key=()=>shipmentForm().querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
it("keeps the actual shipment form identity after committed partial shipment loses its response",async()=>{
  await render();const original=key();expect(original).not.toBe("");
  const f=new FormData(shipmentForm());f.set("qty_00000000-0000-4000-8000-000000000002","2");
  state.rpc.mockResolvedValue({data:null,error:{message:"Response lost after commit"}});
  await expect(buatPengiriman(f)).rejects.toThrow(/error=/);
  state.shipped=12;
  await act(async()=>root.unmount());root=createRoot(container);
  await render({error:"Response lost after commit"});
  expect(key()).toBe(original);
  expect(shipmentForm().textContent).toContain("Periksa hasil transaksi terakhir");
  state.rpc.mockResolvedValue({data:{document_id:"committed-delivery",document_no:"DO.TEST.1"},error:null});
  await expect(recoverSalesSubmission(new FormData(shipmentForm()))).rejects.toThrow(new RegExp(`request_done=${original}`));
  expect(state.rpc.mock.calls.map(call=>call[0])).toEqual(["sales_create_delivery","sales_get_posting_result"]);
  expect(state.rpc.mock.calls[1][1]).toEqual({p_order_id:"00000000-0000-4000-8000-000000000001",p_kind:"delivery",p_request_key:original});
  await render({request_done:original,request_scope:"delivery:00000000-0000-4000-8000-000000000001"});
  expect(key()).not.toBe(original);
});
it("rotates the actual form identity only after confirmation of its own request",async()=>{
  await render();const original=key();
  await render({error:"ordinary validation failure"});expect(key()).toBe(original);
  await render({request_done:"unrelated",request_scope:"delivery:00000000-0000-4000-8000-000000000001"});expect(key()).toBe(original);
  await render({request_done:original,request_scope:"delivery:00000000-0000-4000-8000-000000000001"});expect(key()).not.toBe(original);
});

it("retains recovery when the committed shipment exhausts its visible form",async()=>{
  await render();const original=key();state.shipped=20;
  await act(async()=>root.unmount());root=createRoot(container);
  await render({error:"Lost response"});
  expect(container.textContent).not.toContain("Catat pengiriman");
  const recovery=Array.from(container.querySelectorAll("form")).find(f=>f.querySelector<HTMLInputElement>('input[name="request_scope"]')?.value.startsWith("delivery:"))!;
  expect(recovery.querySelector<HTMLInputElement>('input[name="request_key"]')?.value).toBe(original);
  expect(recovery.textContent).toContain("Periksa hasil transaksi terakhir");
});
it("retains invoice identity after partial billing and isolates it from shipment confirmation",async()=>{
  await render();const invoice=()=>Array.from(container.querySelectorAll("form")).find(f=>f.textContent?.includes("Terbitkan faktur"))!;
  const invoiceKey=()=>invoice().querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
  const original=invoiceKey();const deliveryKey=key();state.billed=7;
  await act(async()=>root.unmount());root=createRoot(container);await render({error:"Invoice response lost"});
  expect(invoiceKey()).toBe(original);
  await render({request_done:deliveryKey,request_scope:"delivery:00000000-0000-4000-8000-000000000001"});
  expect(invoiceKey()).toBe(original);
});
it("fails closed when the tab cannot persist its request identity",async()=>{
  const broken=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("Storage blocked");});
  try{
    await render();expect(key()).toBe("");expect(container.textContent).toContain("Penyimpanan sesi browser tidak tersedia");
    await expect(buatPengiriman(new FormData(shipmentForm()))).rejects.toThrow(/error=/);
    expect(state.rpc).not.toHaveBeenCalled();
  }finally{broken.mockRestore();}
});

it("restores shipment quantities and headers after failed reset and page reload",async()=>{
 await render();const form=shipmentForm();const qty=form.querySelector<HTMLInputElement>('input[name^="qty_"]')!;const resi=form.querySelector<HTMLInputElement>('input[name="no_resi"]')!;
 await act(async()=>{qty.value="2";qty.dispatchEvent(new Event("input",{bubbles:true}));resi.value="TRACK-77";resi.dispatchEvent(new Event("input",{bubbles:true}));form.reset();});
 expect(qty.value).toBe("2");
 await act(async()=>root.unmount());root=createRoot(container);await render({error:"Connection lost"});
 expect(shipmentForm().querySelector<HTMLInputElement>('input[name^="qty_"]')!.value).toBe("2");expect(shipmentForm().querySelector<HTMLInputElement>('input[name="no_resi"]')!.value).toBe("TRACK-77");
});

it("clears matching shipment contents and starts fresh after server acknowledgement",async()=>{
 await render();const original=key();const resi=shipmentForm().querySelector<HTMLInputElement>('input[name="no_resi"]')!;
 await act(async()=>{resi.value="OLD-TRACK";resi.dispatchEvent(new Event("input",{bubbles:true}));const qty=shipmentForm().querySelector<HTMLInputElement>('input[name^="qty_"]')!;qty.value="2";qty.dispatchEvent(new Event("input",{bubbles:true}));});
 state.shipped=12;
 await render({request_done:original,request_scope:"delivery:00000000-0000-4000-8000-000000000001"});
 expect(shipmentForm().querySelector<HTMLInputElement>('input[name="no_resi"]')!.value).toBe("");
 expect(shipmentForm().querySelector<HTMLInputElement>('input[name^="qty_"]')!.value).toBe("8");
 expect(sessionStorage.getItem("vetos:transaction-draft:v1:owner:sales:delivery:00000000-0000-4000-8000-000000000001")).toBeNull();
});
