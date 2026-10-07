// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock("@/app/(app)/keuangan/jurnal/actions",()=>({jurnalManual:vi.fn()}));
vi.mock("@/app/(app)/keuangan/jurnal-berulang/actions",()=>({buatRecurring:vi.fn()}));
vi.mock("@/app/(app)/keuangan/saldo-awal/actions",()=>({simpanSaldoAwal:vi.fn()}));
vi.mock("@/app/(app)/keuangan/rekonsiliasi/actions",()=>({prosesRekonsiliasi:vi.fn()}));
import {JurnalForm} from "@/app/(app)/keuangan/jurnal/JurnalForm";
import {RecurringForm} from "@/app/(app)/keuangan/jurnal-berulang/RecurringForm";
import {SaldoAwalForm} from "@/app/(app)/keuangan/saldo-awal/SaldoAwalForm";
import {RekonForm} from "@/app/(app)/keuangan/rekonsiliasi/RekonForm";
let root:Root,host:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const forms=[
 ["journal",(userId:string)=> <JurnalForm userId={userId} accounts={[]} branches={[]}/>],
 ["recurring",(userId:string)=> <RecurringForm userId={userId} accounts={[]} branches={[]}/>],
 ["opening",(userId:string)=> <SaldoAwalForm userId={userId} akun={[]} usulan={[]}/>],
 ["reconciliation",(userId:string)=> <RekonForm userId={userId} rekening={[{id:"bank",nama:"Bank",coa_code:"1102",saldo:0}]} hariIni="2026-10-07"/>],
] as const;
async function edit(input:HTMLInputElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});}
it.each(forms)("%s preserves controlled amounts across reset/reload and isolates account",async(_label,form)=>{
 await act(async()=>root.render(form("a")));await edit(host.querySelector<HTMLInputElement>('input[type="number"]:not([name]) , input[name="saldo_bank"]')!,"123");
 await act(async()=>host.querySelector("form")!.reset());expect(host.querySelector<HTMLInputElement>('input[type="number"]:not([name]) , input[name="saldo_bank"]')!.value).toBe("123");
 await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(form("a")));expect(host.querySelector<HTMLInputElement>('input[type="number"]:not([name]) , input[name="saldo_bank"]')!.value).toBe("123");
 await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(form("b")));expect(host.querySelector<HTMLInputElement>('input[type="number"]:not([name]) , input[name="saldo_bank"]')!.value).not.toBe("123");
});
it.each(forms)("%s clears controlled state only for its exact acknowledgement",async(_label,form)=>{
 await act(async()=>root.render(form("a")));await edit(host.querySelector<HTMLInputElement>('input[type="number"]:not([name]) , input[name="saldo_bank"]')!,"123");
 const scope=host.querySelector<HTMLInputElement>('input[name="draft_scope"]')!.value,key=host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value;
 await act(async()=>window.dispatchEvent(new CustomEvent("vetos:transaction-confirmed",{detail:{scope,key:"wrong"}})));expect(host.querySelector<HTMLInputElement>('input[type="number"]:not([name]) , input[name="saldo_bank"]')!.value).toBe("123");
 await act(async()=>window.dispatchEvent(new CustomEvent("vetos:transaction-confirmed",{detail:{scope,key}})));expect(host.querySelector<HTMLInputElement>('input[type="number"]:not([name]) , input[name="saldo_bank"]')!.value).not.toBe("123");
});

import {jurnalManual} from "@/app/(app)/keuangan/jurnal/actions";
import {buatRecurring} from "@/app/(app)/keuangan/jurnal-berulang/actions";
import {simpanSaldoAwal} from "@/app/(app)/keuangan/saldo-awal/actions";
import {prosesRekonsiliasi} from "@/app/(app)/keuangan/rekonsiliasi/actions";
it.each(forms)("%s retains its real controlled amount after transport rejection with no replay",async(label,form)=>{
 const action={journal:jurnalManual,recurring:buatRecurring,opening:simpanSaldoAwal,reconciliation:prosesRekonsiliasi}[label];
 vi.mocked(action).mockRejectedValueOnce(Error("network"));
 await act(async()=>root.render(form("a")));await edit(host.querySelector<HTMLInputElement>('input[type="number"]:not([name]), input[name="saldo_bank"]')!,"123");
 await act(async()=>{host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
 expect(host.textContent).toContain("Periksa daftar transaksi");expect(host.querySelector<HTMLInputElement>('input[type="number"]:not([name]), input[name="saldo_bank"]')!.value).toBe("123");
 expect(action).toHaveBeenCalledTimes(1);vi.mocked(action).mockClear();
});
