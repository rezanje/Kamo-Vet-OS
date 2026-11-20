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
it("simple edit like Accurate: date, accounts, both branches and amount editable, read-only recovery",async()=>{
 // 19 Nov 2026 (Anisa): koreksi = ubah langsung; cabang asal & tujuan boleh diganti.
 const header={id:"transfer",revision:0,tanggal:"2026-10-20",from_account_id:"cash",to_account_id:"bank",jumlah:1000,biaya_admin:0,branch_id:"a",keterangan:null};
 await act(async()=>root.render(<TransferForm userId="owner" mode="edit" header={header} rekening={[{id:"cash",label:"Cash"},{id:"bank",label:"Bank"}]} branches={[{id:"a",name:"Cabang A"},{id:"b",name:"Cabang B"}]}/>));
 expect(host.textContent).toContain("Catatan lama otomatis dibatalkan");
 const date=host.querySelector<HTMLInputElement>('input[name="tanggal"]');
 expect(date?.getAttribute("type")).toBe("date"); expect(date?.value).toBe("2026-10-20");
 expect(host.querySelector<HTMLSelectElement>('select[name="branch_id"]')?.value).toBe("a");
 // Catatan lama tanpa cabang tujuan: tujuan = asal.
 expect(host.querySelector<HTMLSelectElement>('select[name="to_branch_id"]')?.value).toBe("a");
 expect(host.textContent).toContain("Simpan perubahan");
 expect(host.querySelector<HTMLButtonElement>('button[value="periksa"]')?.formNoValidate).toBe(true);
});
it("fills the branch from the chosen account and flags an inter-branch transfer",async()=>{
 await act(async()=>root.render(<TransferForm userId="owner" rekening={[{id:"cash",label:"Kas Toko A",branch_id:"a"},{id:"bank",label:"Bank Pusat",branch_id:null},{id:"kasb",label:"Kas Toko B",branch_id:"b"}]} branches={[{id:"a",name:"Cabang A"},{id:"b",name:"Cabang B"}]}/>));
 const pick=async(name:string,value:string)=>act(async()=>{const el=host.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;el.value=value;el.dispatchEvent(new Event("change",{bubbles:true}));});
 await pick("from_account_id","cash");
 expect(host.querySelector<HTMLSelectElement>('select[name="branch_id"]')!.value).toBe("a");
 expect(host.textContent).not.toContain("Antar cabang");
 // Tujuan belum dipilih sendiri: ikut cabang asal; rekening tanpa cabang tidak mengubahnya.
 expect(host.querySelector<HTMLSelectElement>('select[name="to_branch_id"]')!.value).toBe("a");
 await pick("to_account_id","bank");
 expect(host.querySelector<HTMLSelectElement>('select[name="to_branch_id"]')!.value).toBe("a");
 expect(host.textContent).not.toContain("Antar cabang");
 await pick("to_account_id","kasb");
 expect(host.querySelector<HTMLSelectElement>('select[name="to_branch_id"]')!.value).toBe("b");
 expect(host.textContent).toContain("Antar cabang");
 await pick("branch_id","");
 expect(host.querySelector<HTMLSelectElement>('select[name="to_branch_id"]')!.value).toBe("b");
 await pick("to_branch_id","");
 expect(host.querySelector<HTMLSelectElement>('select[name="to_branch_id"]')!.value).toBe("");
 expect(host.textContent).not.toContain("Antar cabang");
});
it("serializes a double submit while the first result is uncertain",async()=>{
 let finish:()=>void=()=>{};
 vi.mocked(buatTransfer).mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
 await render();
 await act(async()=>{
  host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 });
 expect(buatTransfer).toHaveBeenCalledTimes(1);
 await act(async()=>finish());
 expect(host.textContent).toContain("belum terkonfirmasi");
});
