// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/app/kasir/checkout",()=>({checkoutKasir:vi.fn()}));
vi.mock("@/app/kasir/actions", async () => (await import("./helpers/kasir-actions-mock")).kasirActionsMock);
import { KasirClient, type ItemRow } from "@/app/kasir/KasirClient";
let root:Root,host:HTMLDivElement;
const item:ItemRow={id:"service",name:"Grooming",code:"GROOM",itemType:"Jasa",harga:100,kategori:"Jasa",stok:null};
const staff=[{id:"d",nama:"Fictional doctor",jabatan:"Dokter"},{id:"g",nama:"Fictional groomer",jabatan:"Groomer"},{id:"n",nama:"Fictional nurse",jabatan:"Perawat"}];
const cart=()=>JSON.parse(host.querySelector<HTMLInputElement>('input[name="cart"]')!.value);
beforeEach(async()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();host=document.createElement("div");document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(<KasirClient branchName="Fictional" items={[item]} vouchers={[]} hariIni="2026-10-23" salespeople={staff}/>));
 await act(async()=>new Promise(resolve=>setTimeout(resolve,5)));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const add=async()=>act(async()=>host.querySelector<HTMLButtonElement>('button[title="Tambah"]')!.click());
it("adds two identical services as separate stable rows and edits only the chosen row performer",async()=>{
 await add();await add();expect(cart()).toHaveLength(2);expect(cart()[0].row_key).not.toBe(cart()[1].row_key);
 const fields=host.querySelectorAll("tbody fieldset");expect(fields).toHaveLength(2);
 const choose=fields[1].querySelectorAll("select")[1];await act(async()=>{choose.value="g";choose.dispatchEvent(new Event("change",{bubbles:true}));});
 expect(cart()[0].service_performers.staff_id).toBeNull();expect(cart()[1].service_performers.staff_id).toBe("g");
 expect(host.textContent).not.toContain("Tenaga penjual / pelaksana *");
});
it("bulk fill preserves row overrides and an individual quantity remains independent",async()=>{
 await add();await add();
 const fields=host.querySelectorAll("tbody fieldset");const chosen=fields[1].querySelectorAll("select")[1];
 await act(async()=>{chosen.value="n";chosen.dispatchEvent(new Event("change",{bubbles:true}));});
 const bulk=Array.from(host.querySelectorAll("fieldset")).find(field=>field.textContent?.includes("Isi pelaksana baris kosong"))!;
 expect(bulk).toBeTruthy();const pick=bulk.querySelectorAll("select")[1];
 await act(async()=>{pick.value="g";pick.dispatchEvent(new Event("change",{bubbles:true}));});
 await act(async()=>Array.from(host.querySelectorAll("button")).find(button=>button.textContent==="Isi baris kosong")!.click());
 expect(cart().map((row:{service_performers:{staff_id:string}})=>row.service_performers.staff_id)).toEqual(["g","n"]);
 const plus=fields[0].closest("tr")!.querySelectorAll<HTMLButtonElement>(".kpos-qtybtn")[1];await act(async()=>plus.click());
 expect(cart().map((row:{qty:number})=>row.qty)).toEqual([2,1]);
});
