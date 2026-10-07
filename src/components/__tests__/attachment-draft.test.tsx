// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams()}));
const upload=vi.hoisted(()=>vi.fn(async()=>({error:null})));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({storage:{from:()=>({upload})}})}));
import {LampiranPicker} from "../LampiranPicker";
import {TransactionForm} from "../LocalTransactionDraft";
let root:Root,host:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();upload.mockClear();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const form=()=> <TransactionForm userId="a" scope="upload" action={async()=>{}}><LampiranPicker folder="pembelian"/></TransactionForm>;
it("restores uploaded references and visible names without replaying file bytes",async()=>{
 await act(async()=>root.render(form()));const input=host.querySelector<HTMLInputElement>('input[type="file"]')!;Object.defineProperty(input,"files",{value:[new File(["test"],"invoice.pdf",{type:"application/pdf"})]});await act(async()=>input.dispatchEvent(new Event("change",{bubbles:true})));
 const value=host.querySelector<HTMLInputElement>('input[name="lampiran"]')!.value;expect(upload).toHaveBeenCalledTimes(1);
 await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(form()));expect(host.querySelector<HTMLInputElement>('input[name="lampiran"]')!.value).toBe(value);expect(host.textContent).toContain("invoice.pdf");expect(upload).toHaveBeenCalledTimes(1);
});
it("rejects references outside the expected upload folder",async()=>{
 await act(async()=>root.render(form()));const input=host.querySelector<HTMLInputElement>('input[name="lampiran"]')!;
 await act(async()=>input.dispatchEvent(new CustomEvent("vetos:draft-restore",{detail:JSON.stringify([{path:"../secret",nama:"secret",mime:null,ukuran:4}])})));
 expect(input.value).toBe("[]");expect(host.textContent).toContain("tidak dapat dipulihkan");
});
it("keeps uploaded files on unconfirmed reset and clears only matching success",async()=>{
 await act(async()=>root.render(form()));const input=host.querySelector<HTMLInputElement>('input[name="lampiran"]')!;
 const refs=[{path:"pembelian/test.pdf",nama:"invoice.pdf",mime:"application/pdf",ukuran:4}];
 await act(async()=>input.dispatchEvent(new CustomEvent("vetos:draft-restore",{detail:JSON.stringify(refs)})));
 await act(async()=>host.querySelector("form")!.reset());expect(input.value).toBe(JSON.stringify(refs));
 const key=host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value;
 await act(async()=>window.dispatchEvent(new CustomEvent("vetos:transaction-confirmed",{detail:{scope:"upload",key}})));
 expect(input.value).toBe("[]");
});
