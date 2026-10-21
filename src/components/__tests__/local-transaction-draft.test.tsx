// @vitest-environment jsdom
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams()}));
import {TransactionForm,usePreservedAction} from "../LocalTransactionDraft";
import {transactionDraftName} from "../TransactionDraft";
let root:Root,host:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function render(userId="a",action=vi.fn(async()=>{})){await act(async()=>root.render(<TransactionForm userId={userId} scope="test" action={action}><input name="note"/><button>Save</button></TransactionForm>));}
async function edit(){await act(async()=>{const input=host.querySelector<HTMLInputElement>('input[name="note"]')!;input.value="KEEP";input.dispatchEvent(new Event("input",{bubbles:true}));});}
it("retains fields after unconfirmed action resolution, rejects unrelated acknowledgement, clears exact confirmation",async()=>{await render();await edit();const key=host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value;await act(async()=>host.querySelector("form")!.reset());expect(host.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe("KEEP");await act(async()=>window.dispatchEvent(new CustomEvent("vetos:transaction-confirmed",{detail:{scope:"test",key:"other"}})));expect(sessionStorage.getItem(transactionDraftName("a","transaction","test"))).not.toBeNull();await act(async()=>window.dispatchEvent(new CustomEvent("vetos:transaction-confirmed",{detail:{scope:"test",key}})));expect(sessionStorage.getItem(transactionDraftName("a","transaction","test"))).toBeNull();});
it("isolates accounts and restores a tab's draft on remount",async()=>{await render();await edit();await act(async()=>root.unmount());root=createRoot(host);await render("b");expect(host.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe("");await act(async()=>root.unmount());root=createRoot(host);await render("a");expect(host.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe("KEEP");});
it("shows transport uncertainty and never replays a failed save",async()=>{const action=vi.fn(async()=>{throw Error("network")});await render("a",action);await edit();await act(async()=>host.querySelector("form")!.requestSubmit());expect(action).toHaveBeenCalledTimes(1);expect(host.textContent).toContain("Periksa daftar transaksi");expect(host.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe("KEEP");});
it("does not carry form fields across an account change without unmounting",async()=>{await render();await edit();await render("b");expect(host.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe("");await render("a");expect(host.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe("KEEP");});
it("restores named checkbox selections",async()=>{const form=()=> <TransactionForm userId="a" scope="checks" action={async()=>{}}><input type="checkbox" name="pilih_invoice"/><input name="amount"/></TransactionForm>;await act(async()=>root.render(form()));await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(form()));expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);});

it("warns when a save returns without confirmation and restores the same input and key after reload",async()=>{
 const action=vi.fn(async()=>{});await render("a",action);await edit();
 const key=host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value;
 await act(async()=>host.querySelector("form")!.requestSubmit());
 expect(host.querySelector('[role="alert"]')?.textContent).toContain("Respons simpan belum terkonfirmasi");
 expect(host.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe("KEEP");
 expect(action).toHaveBeenCalledTimes(1);
 await act(async()=>root.unmount());root=createRoot(host);await render();
 expect(host.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe("KEEP");
 expect(host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value).toBe(key);
});

it("announces processing while the server response is pending, then shows uncertainty without clearing input",async()=>{
 let finish!:()=>void;const action=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 await render("a",action);await edit();
 await act(async()=>host.querySelector("form")!.requestSubmit());
 expect(host.querySelector('[role="status"]')?.textContent).toBe("Memproses transaksi…");
 expect(host.querySelector('[role="alert"]')).toBeNull();
 await act(async()=>finish());
 expect(host.querySelector('[role="alert"]')?.textContent).toContain("Periksa daftar transaksi");
 expect(host.textContent).not.toContain("Memproses transaksi…");
 expect(host.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe("KEEP");
});

it("passes confirmed navigation through without reporting failure or success itself",async()=>{
 const redirect=Object.assign(Error("redirect"),{digest:"NEXT_REDIRECT;replace;/saved;303;"});
 let save!:(data:FormData)=>Promise<void>;
 function Harness(){const state=usePreservedAction(async()=>{throw redirect;});save=state.save;return <span>{state.failure}</span>;}
 await act(async()=>root.render(<Harness/>));
 await act(async()=>{await expect(save(new FormData())).rejects.toBe(redirect);});
 expect(host.textContent).toBe("");
});
