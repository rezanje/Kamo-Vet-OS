// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("@/app/(app)/pembelian/faktur/actions",()=>({buatFaktur:vi.fn()}));
vi.mock("@/app/(app)/pembelian/actions",()=>({recoverPurchaseSubmission:vi.fn(),terimaBarang:vi.fn()}));
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
import { FakturForm } from "@/app/(app)/pembelian/faktur/baru/FakturForm";
import { transactionDraftName } from "@/components/TransactionDraft";
import { PurchaseRecoveryComplete } from "@/components/PurchaseRequestKey";
import { TerimaForm } from "@/app/(app)/pembelian/[id]/terima/TerimaForm";
const options=[{id:"po1",label:"PO 1",terminHari:30,warning:null,items:[{po_item_id:"line1",item_id:"item1",nama:"Obat",harga_po:100,sisa:10,satuan:"box",faktor:10,blockedReason:null}]}];
let container:HTMLDivElement;let root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
async function invoice(userId="owner"){await act(async()=>root.render(<FakturForm userId={userId} options={options}/>));}
async function remount(){await act(async()=>root.unmount());root=createRoot(container);}
async function edit(control:HTMLInputElement|HTMLSelectElement,value:string){
 await act(async()=>{Object.getOwnPropertyDescriptor(control instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value")!.set!.call(control,value);control.dispatchEvent(new Event(control instanceof HTMLSelectElement?"change":"input",{bubbles:true}));});
}
it("restores the actual purchase invoice PO, quantities, prices and supplier header after reload",async()=>{
 await invoice();await edit(container.querySelector("select")!,"po1");
 await edit(container.querySelector('input[name="no_faktur_pemasok"]')!,"INV-SUP-77");
 await edit(container.querySelector('input[title="Qty faktur dalam box"]')!,"3");
 await edit(container.querySelector('input[title="Harga faktur per box"]')!,"250");
 expect(JSON.parse(container.querySelector<HTMLInputElement>('input[name="items"]')!.value)).toEqual([{po_item_id:"line1",qty:3,harga:250}]);
 const key=container.querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
 await remount();await invoice();
 expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("po1");
 expect(container.querySelector<HTMLInputElement>('input[name="no_faktur_pemasok"]')!.value).toBe("INV-SUP-77");
 expect(container.querySelector<HTMLInputElement>('input[title="Qty faktur dalam box"]')!.value).toBe("3");
 expect(JSON.parse(container.querySelector<HTMLInputElement>('input[name="items"]')!.value)).toEqual([{po_item_id:"line1",qty:3,harga:250}]);
 expect(container.querySelector<HTMLInputElement>('input[name="request_key"]')!.value).toBe(key);
});
it("does not restore another account's purchase draft",async()=>{
 await invoice();await edit(container.querySelector("select")!,"po1");await edit(container.querySelector('input[name="no_faktur_pemasok"]')!,"PRIVATE");
 await remount();await invoice("other");expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("");
 await remount();await invoice();expect(container.querySelector<HTMLInputElement>('input[name="no_faktur_pemasok"]')!.value).toBe("PRIVATE");
});
it("prevents a form reset after an unconfirmed save from losing purchase fields",async()=>{
 await invoice();const input=container.querySelector<HTMLInputElement>('input[name="no_faktur_pemasok"]')!;await edit(input,"KEEP-ME");
 await act(async()=>{container.querySelector("form")!.reset();});expect(input.value).toBe("KEEP-ME");
});
it("restores receipt quantities, damage notes and multiple expiry batches",async()=>{
 const render=async()=>{await act(async()=>root.render(<TerimaForm userId="owner" poId="po1" noPo="PO1" supplier="Supplier" gudang="Gudang" totalPO={1000} rows={[{id:"line1",nama:"Obat",qty:10,harga_beli:100,satuan:"box",trackExpiry:true}]}/>));};
 await render();await edit(container.querySelector('input[name="surat_jalan"]')!,"SJ-22");
 const nums=container.querySelectorAll<HTMLInputElement>('input[type="number"]');await edit(nums[0],"6");await edit(nums[1],"2");
 await act(async()=>{Array.from(container.querySelectorAll("button")).find(b=>b.textContent?.includes("Tanggal lain"))!.click();});
 await edit(container.querySelectorAll<HTMLInputElement>('input[type="number"]')[2],"2");
 const dates=container.querySelectorAll<HTMLInputElement>('input[type="date"]');await edit(dates[1],"2027-01-01");await edit(dates[2],"2028-01-01");
 const expected=container.querySelector<HTMLInputElement>('input[name="rows"]')!.value;
 await remount();await render();expect(container.querySelector<HTMLInputElement>('input[name="surat_jalan"]')!.value).toBe("SJ-22");expect(container.querySelector<HTMLInputElement>('input[name="rows"]')!.value).toBe(expected);
});

it("clears only its acknowledged draft, retaining unrelated confirmations",async()=>{
 await invoice();await edit(container.querySelector('input[name="no_faktur_pemasok"]')!,"ACK-ME");
 const key=container.querySelector<HTMLInputElement>('input[name="request_key"]')!.value;const name=transactionDraftName("owner","purchase","invoice");
 await act(async()=>root.render(<><PurchaseRecoveryComplete userId="owner" scope="invoice" requestKey="unrelated"/><FakturForm userId="owner" options={options}/></>));
 expect(sessionStorage.getItem(name)).not.toBeNull();
 await act(async()=>root.render(<><PurchaseRecoveryComplete userId="owner" scope="invoice" requestKey={key}/><FakturForm userId="owner" options={options}/></>));
 expect(sessionStorage.getItem(name)).toBeNull();
});
it.each(["expired","malformed"])("opens safely and warns for a %s draft",async(mode)=>{
 await invoice();await edit(container.querySelector('input[name="no_faktur_pemasok"]')!,"OLD");
 const name=transactionDraftName("owner","purchase","invoice");const saved=JSON.parse(sessionStorage.getItem(name)!);
 if(mode==="expired")saved.savedAt=Date.now()-13*60*60*1000;else saved.snapshot.qty={line1:"bad"};
 sessionStorage.setItem(name,JSON.stringify(saved));await remount();await invoice();
 expect(container.querySelector<HTMLInputElement>('input[name="no_faktur_pemasok"]')!.value).toBe("");expect(container.textContent).toContain("Draf lama tidak dapat dipulihkan");
});
it("keeps fields visible and warns when browser storage refuses a draft",async()=>{
 await invoice();const broken=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("Storage full");});
 await edit(container.querySelector('input[name="no_faktur_pemasok"]')!,"STAY-HERE");
 expect(container.textContent).toContain("Draf browser tidak dapat disimpan");expect(container.querySelector<HTMLInputElement>('input[name="no_faktur_pemasok"]')!.value).toBe("STAY-HERE");broken.mockRestore();
});
