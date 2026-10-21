// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({change:vi.fn()}));
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams("view=inactive&cari=kucing&hal=2")}));
vi.mock("@/app/(app)/master-data/actions",()=>({changeMasterLifecycle:mocks.change}));
import {MasterLifecycleActions} from "../MasterLifecycleActions";
let root:Root,container:HTMLDivElement;
const props={entity:"employees" as const,id:"11111111-1111-4111-8111-111111111111",name:"Karyawan Uji",active:true,revision:4};
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});mocks.change.mockReset();container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const button=(label:string)=>Array.from(container.querySelectorAll("button")).find(b=>b.textContent===label)!;
async function reason(text:string){const input=container.querySelector("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,text);await act(async()=>input.dispatchEvent(new Event("input",{bubbles:true})));}
async function submit(){await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));}
it("requires explicit confirmation with an honest recoverable-trash explanation",async()=>{await act(async()=>root.render(<MasterLifecycleActions {...props}/>));await act(async()=>button("Pindah ke Sampah").click());expect(container.textContent).toContain("tidak dihapus permanen");expect(container.textContent).toContain("tidak mencabut akses login");expect(container.querySelector("textarea")!.required).toBe(true);expect(mocks.change).not.toHaveBeenCalled();});
it("retains the reason and form when the server rejects a referenced row",async()=>{mocks.change.mockResolvedValue({error:"Data memiliki riwayat; gunakan Nonaktifkan"});await act(async()=>root.render(<MasterLifecycleActions {...props}/>));await act(async()=>button("Pindah ke Sampah").click());await reason("Entri ganda");await submit();expect(container.querySelector('[role="alert"]')?.textContent).toContain("riwayat");expect(container.querySelector("textarea")!.value).toBe("Entri ganda");const data=mocks.change.mock.calls[0][0] as FormData;expect(data.get("revision")).toBe("4");expect(data.get("filters")).toBe("view=inactive&cari=kucing&hal=2");expect(data.get("reason")).toBe("Entri ganda");});
it("keeps input and warns about an uncertain outcome after a transport failure",async()=>{mocks.change.mockRejectedValue(new Error("network"));await act(async()=>root.render(<MasterLifecycleActions {...props}/>));await act(async()=>button("Nonaktifkan").click());await reason("Tidak bertugas");await submit();expect(container.textContent).toContain("belum terkonfirmasi");expect(container.querySelector("textarea")!.value).toBe("Tidak bertugas");});
it("offers only restore in trash and explains its inactive result",async()=>{await act(async()=>root.render(<MasterLifecycleActions {...props} active={false} trashed/>));expect(button("Pindah ke Sampah")).toBeUndefined();expect(button("Aktifkan")).toBeUndefined();await act(async()=>button("Pulihkan").click());expect(container.textContent).toContain("daftar Nonaktif");});
it("disables conflicting row actions while saving",async()=>{let done!:(value:{error:string})=>void;mocks.change.mockImplementation(()=>new Promise(resolve=>{done=resolve}));await act(async()=>root.render(<MasterLifecycleActions {...props}/>));await act(async()=>button("Nonaktifkan").click());await reason("Tidak bertugas");await submit();expect(button("Pindah ke Sampah").disabled).toBe(true);await act(async()=>done({error:"stale"}));expect(button("Pindah ke Sampah").disabled).toBe(false);});
