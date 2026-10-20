// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock("@/app/(app)/kas-bank/transfer/actions",()=>({buatTransfer:vi.fn(),koreksiTransfer:vi.fn(),batalkanTransfer:vi.fn()}));
import {TransferForm} from "@/app/(app)/kas-bank/transfer/TransferForm";
import {buatTransfer} from "@/app/(app)/kas-bank/transfer/actions";
let root:Root,host:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();host=document.createElement("div");document.body.append(host);root=createRoot(host);vi.mocked(buatTransfer).mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function edit(name:string,value:string){await act(async()=>{const el=host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;el.value=value;el.dispatchEvent(new Event("input",{bubbles:true}));});}
const render=async(userId="owner")=>act(async()=>root.render(<TransferForm userId={userId} rekening={[{id:"cash",label:"Cash"},{id:"bank",label:"Bank"}]}/>));
it("keeps amount, note and stable request after failed save and reload",async()=>{
 await render();await edit("jumlah","123.45");await edit("keterangan","Unsent transfer");
 const key=host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value;
 vi.mocked(buatTransfer).mockRejectedValueOnce(Error("network"));
 await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
 expect(host.textContent).toContain("Isian tetap tersedia");
 await act(async()=>root.unmount());root=createRoot(host);await render();
 expect(host.querySelector<HTMLInputElement>('input[name="jumlah"]')!.value).toBe("123.45");
 expect(host.querySelector<HTMLInputElement>('input[name="keterangan"]')!.value).toBe("Unsent transfer");
 expect(host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value).toBe(key);
});
it("isolates mounted account changes and correction revisions",async()=>{
 await render();await edit("jumlah","123.45");await render("other-owner");
 expect(host.querySelector<HTMLInputElement>('input[name="jumlah"]')!.value).toBe("");
 const base={id:"transfer",revision:0,tanggal:"2026-10-20",from_account_id:"cash",to_account_id:"bank",jumlah:100,biaya_admin:0,keterangan:null};
 await act(async()=>root.render(<TransferForm userId="owner" mode="edit" header={base}/>));await edit("jumlah","888");
 await act(async()=>root.render(<TransferForm userId="owner" mode="edit" header={{...base,revision:1,jumlah:200}}/>));
 expect(host.querySelector<HTMLInputElement>('input[name="jumlah"]')!.value).toBe("200");
});
