// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams(),useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions",()=>({bayarRombongan:vi.fn()}));
import { DraftUserProvider, PreservedForm } from "@/components/LocalTransactionDraft";
import { BarisForm } from "@/app/(app)/pos/penyesuaian/baru/BarisForm";
import { LingkupPicker } from "@/app/kasir/opname/baru/LingkupPicker";
import { LunasiRombonganForm } from "@/app/(app)/klinik/pembayaran/[visitId]/LunasiRombonganForm";
vi.mock("@/lib/supabase/client",()=>({createClient:vi.fn()}));
vi.mock("@/app/(app)/klinik/registrasi/actions",()=>({registrasiPasien:vi.fn(),registrasiDanBayar:vi.fn(),lookupPetsByPhone:vi.fn()}));
import { RegistrasiForm } from "@/app/(app)/klinik/registrasi/RegistrasiForm";
import { transactionDraftName } from "@/components/TransactionDraft";
let container:HTMLDivElement;let root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const noop=async()=>{};
async function remount(){await act(async()=>root.unmount());root=createRoot(container);}
async function input(control:HTMLInputElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(control,value);control.dispatchEvent(new Event("input",{bubbles:true}));});}
const barang=[{item_id:"item-a",code:"A",nama:"Obat A",unit:"pcs",qty:10},{item_id:"item-b",code:"B",nama:"Obat B",unit:"pcs",qty:8}];
async function adjustment(scope="inventory-adjustment:warehouse-a",action=noop){await act(async()=>root.render(<DraftUserProvider userId="user-a"><PreservedForm action={action}><BarisForm barang={barang} scope={scope}/></PreservedForm></DraftUserProvider>));}
it("restores adjustments hidden from the active search and isolates warehouses",async()=>{
 await adjustment();await input(container.querySelectorAll<HTMLInputElement>('input[type="number"]')[1],"5");await input(container.querySelector<HTMLInputElement>('input[placeholder^="Cari"]')!,"Obat A");
 const expected=container.querySelector<HTMLInputElement>('input[name="baris"]')!.value;
 await remount();await adjustment();expect(container.querySelector<HTMLInputElement>('input[name="baris"]')!.value).toBe(expected);
 await remount();await adjustment("inventory-adjustment:warehouse-b");expect(container.querySelector<HTMLInputElement>('input[name="baris"]')!.value).toBe("[]");
});
it("retains snapshot on rejected transport and clears only exact confirmed key",async()=>{
 await adjustment(undefined,async()=>{throw new Error("offline");});await input(container.querySelectorAll<HTMLInputElement>('input[type="number"]')[0],"6");
 const name=transactionDraftName("user-a","transaction","inventory-adjustment:warehouse-a");const key=container.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value;
 await act(async()=>container.querySelector("form")!.requestSubmit());expect(container.textContent).toContain("Respons simpan belum terkonfirmasi");expect(sessionStorage.getItem(name)).not.toBeNull();
 await act(async()=>window.dispatchEvent(new CustomEvent("vetos:transaction-confirmed",{detail:{scope:"inventory-adjustment:warehouse-a",key:"another-save"}})));expect(sessionStorage.getItem(name)).not.toBeNull();
 await act(async()=>window.dispatchEvent(new CustomEvent("vetos:transaction-confirmed",{detail:{scope:"inventory-adjustment:warehouse-a",key}})));expect(container.querySelector<HTMLInputElement>('input[name="baris"]')!.value).toBe("[]");
});
it("restores partial opname selection and its actual hidden scope",async()=>{
 const render=async()=>{await act(async()=>root.render(<DraftUserProvider userId="user-a"><PreservedForm action={noop}><LingkupPicker scope="opname-create:warehouse-a" items={[{id:"item-a",code:"A",name:"Obat A",kategori:"Obat"}]}/></PreservedForm></DraftUserProvider>));};
 await render();await act(async()=>Array.from(container.querySelectorAll("button")).find(b=>b.textContent?.includes("Pilih sendiri"))!.click());await act(async()=>container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
 await remount();await render();expect(container.querySelector<HTMLInputElement>('input[name="lingkup_items"]')!.value).toBe("item-a");expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
});
it("restores group payment method, points and RPC key only for that exact visit group",async()=>{
 const render=async(contextKey="owner:visit-a,visit-b")=>{await act(async()=>root.render(<DraftUserProvider userId="user-a"><LunasiRombonganForm contextKey={contextKey} visitId="visit-a" requestKey="new-server-key" jumlahPasien={2} total={1000} tertahan={[]} bekal={{vouchers:[],hariIni:"2026-10-07",customerId:"owner",categoryId:null,poinSaldo:1000,promos:[],aturanDiskon:[],infoBarang:{},golonganPersen:0,rupiahPerPoin:1}}/></DraftUserProvider>));};
 await render();await act(async()=>Array.from(container.querySelectorAll("button")).find(b=>b.textContent?.includes("Transfer"))!.click());
 await remount();await render();expect(container.querySelector<HTMLInputElement>('input[name="metode_bayar"]')!.value).toBe("Transfer");expect(container.querySelector<HTMLInputElement>('input[name="requestKey"]')!.value).toBe("new-server-key");
 await remount();await render("owner:visit-a,visit-c");expect(container.querySelector<HTMLInputElement>('input[name="metode_bayar"]')!.value).toBe("Tunai");
});

it("restores registration pets, active tab and human owner fields without photo bytes",async()=>{
 const render=async(scope="clinic-registration:shift-a")=>{await act(async()=>root.render(<DraftUserProvider userId="user-a"><RegistrasiForm draftScope={scope} branches={[{id:"branch-a",name:"Cabang A"}]}/></DraftUserProvider>));};
 await render();await input(container.querySelector<HTMLInputElement>('input[name="phone"]')!,"081234567890");await input(container.querySelector<HTMLInputElement>('input[name="name"]')!,"Susi");await input(container.querySelector<HTMLInputElement>('input[placeholder="Choco"]')!,"Milo");
 await act(async()=>Array.from(container.querySelectorAll("button")).find(b=>b.textContent?.includes("Tambah hewan"))!.click());await input(container.querySelector<HTMLInputElement>('input[placeholder="Choco"]')!,"Luna");
 const pets=container.querySelector<HTMLInputElement>('input[name="pets"]')!.value;
 await remount();await render();expect(container.querySelector<HTMLInputElement>('input[name="pets"]')!.value).toBe(pets);expect(container.querySelector<HTMLInputElement>('input[placeholder="Choco"]')!.value).toBe("Luna");expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("Susi");
 await remount();await render("clinic-registration:shift-b");expect(container.querySelector<HTMLInputElement>('input[name="phone"]')!.value).toBe("");
});
