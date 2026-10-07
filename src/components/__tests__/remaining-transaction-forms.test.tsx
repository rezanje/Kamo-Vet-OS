// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock("@/app/(app)/pembelian/actions",()=>({buatPO:vi.fn(),recoverPurchaseSubmission:vi.fn()}));
vi.mock("@/app/(app)/pembelian/faktur/langsung/actions",()=>({buatFakturLangsung:vi.fn()}));
vi.mock("@/app/(app)/pos/permintaan/actions",()=>({buatPermintaan:vi.fn()}));
vi.mock("@/app/(app)/klinik/permintaan/actions",()=>({buatPermintaanKlinik:vi.fn()}));
vi.mock("@/components/LampiranPicker",()=>({LampiranPicker:()=>null}));
import {POForm} from "@/app/(app)/pembelian/baru/POForm";
import {FakturLangsungForm} from "@/app/(app)/pembelian/faktur/langsung/FakturLangsungForm";
import {PermintaanForm} from "@/app/(app)/pos/permintaan/baru/PermintaanForm";
import {PermintaanFormKlinik} from "@/app/(app)/klinik/permintaan/baru/PermintaanFormKlinik";
import {BarisJualForm} from "@/app/(app)/penjualan/BarisJualForm";
import {KategoriUmur} from "@/app/(app)/keuangan/aset/KategoriUmur";
let root:Root,host:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function edit(input:HTMLInputElement|HTMLSelectElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event(input instanceof HTMLSelectElement?"change":"input",{bubbles:true}));});}
const forms=[
 ["PO",()=> <POForm userId="a" suppliers={[]} warehouses={[]} branches={[]} items={[]}/>],
 ["direct invoice",()=> <FakturLangsungForm userId="a" suppliers={[]} warehouses={[]} items={[]}/>],
 ["POS request",()=> <PermintaanForm userId="a" branches={[]} warehouses={[]} items={[]}/>],
 ["clinic request",()=> <PermintaanFormKlinik userId="a" branchName="Clinic" warehouses={[]} items={[]}/>],
 ["sales order/quote",()=> <form><BarisJualForm userId="a" scope="sales" listId="sales" items={[]}/></form>],
] as const;
it.each(forms)("restores actual %s dynamic rows after failed save/reload",async(_name,form)=>{
 await act(async()=>root.render(form()));
 await edit(host.querySelector<HTMLInputElement>('input[type="number"]')!,"7");
 const button=Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.includes("Tambah"));
 await act(async()=>button!.click());
 await edit(host.querySelectorAll<HTMLInputElement>('input[type="number"]')[Array.from(host.querySelectorAll('input[type="number"]')).length-1],"3");
 const before=Array.from(host.querySelectorAll<HTMLInputElement>('input[type="number"]')).map(i=>i.value);
 await act(async()=>host.querySelector("form")!.reset());
 expect(Array.from(host.querySelectorAll<HTMLInputElement>('input[type="number"]')).map(i=>i.value)).toEqual(before);
 await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(form()));
 expect(Array.from(host.querySelectorAll<HTMLInputElement>('input[type="number"]')).map(i=>i.value)).toEqual(before);
});
it("restores asset category and overridden economic life together",async()=>{
 const form=()=> <form><KategoriUmur userId="a" kategori={[{id:"one",nama:"One",umur_bulan:48},{id:"two",nama:"Two",umur_bulan:60}]}/></form>;
 await act(async()=>root.render(form()));await edit(host.querySelector("select")!,"two");await edit(host.querySelector<HTMLInputElement>('input[name="umur_bulan"]')!,"72");
 await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(form()));expect(host.querySelector("select")!.value).toBe("two");expect(host.querySelector<HTMLInputElement>('input[name="umur_bulan"]')!.value).toBe("72");
});
it("clears acknowledged controlled rows and keeps defaults on later remount",async()=>{
 const form=()=> <POForm userId="a" suppliers={[]} warehouses={[]} branches={[]} items={[]}/>;
 await act(async()=>root.render(form()));await edit(host.querySelector<HTMLInputElement>('input[type="number"]')!,"7");
 const key=host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value;
 await act(async()=>window.dispatchEvent(new CustomEvent("vetos:transaction-confirmed",{detail:{scope:"po-create",key}})));
 expect(host.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("1");
 await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(form()));expect(host.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("1");
});
