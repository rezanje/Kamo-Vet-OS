// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture=vi.hoisted(()=>({preview:vi.fn(),commit:vi.fn()}));
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock("@/app/(app)/keuangan/aset/[id]/correction-actions",()=>({previewKoreksiAset:fixture.preview,koreksiPembelianAset:fixture.commit}));
import { AssetCorrectionForm } from "@/app/(app)/keuangan/aset/[id]/AssetCorrectionForm";
let root:Root;let host:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();fixture.preview.mockReset();fixture.commit.mockReset();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const render=async(revision=0,harga=100000000)=>act(async()=>root.render(<AssetCorrectionForm userId="owner" assetId="asset" revision={revision} tanggal="2026-10-20" harga={harga}/>));
it("requires a server preview and invalidates it when inputs change",async()=>{
 await render();
 const commit=()=>host.querySelector<HTMLButtonElement>('button[value="simpan"]')!;
 expect(commit().disabled).toBe(true);
 fixture.preview.mockResolvedValue({allowed:true,blockers:[],harga_before:100000000,harga_after:10000000,monthly_before:2083333,monthly_after:208333,cash_code:"110299"});
 await act(async()=>host.querySelector<HTMLButtonElement>('button[data-preview]')!.click());
 expect(commit().disabled).toBe(false);
 expect(host.textContent).toContain("208.333");
 const amount=host.querySelector<HTMLInputElement>('input[name="harga"]')!;
 await act(async()=>{amount.value="20000000";amount.dispatchEvent(new Event("input",{bubbles:true}));});
 expect(commit().disabled).toBe(true);
});
it("shows dependency blockers and retains the request identity after remount",async()=>{
 await render();const key=host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value;
 fixture.preview.mockResolvedValue({allowed:false,blockers:["Sudah ada penyusutan; perlu rekonsiliasi Finance"]});
 await act(async()=>host.querySelector<HTMLButtonElement>('button[data-preview]')!.click());
 expect(host.textContent).toContain("perlu rekonsiliasi Finance");
 expect(host.querySelector<HTMLButtonElement>('button[value="simpan"]')!.disabled).toBe(true);
 await act(async()=>root.unmount());root=createRoot(host);await render();
 expect(host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value).toBe(key);
});
it("ignores a late preview after a user changes and restores the same fields",async()=>{
 await render();let resolve!:(value:unknown)=>void;
 fixture.preview.mockReturnValue(new Promise(done=>{resolve=done;}));
 await act(async()=>host.querySelector<HTMLButtonElement>('button[data-preview]')!.click());
 const amount=host.querySelector<HTMLInputElement>('input[name="harga"]')!;
 await act(async()=>{amount.value="90000000";amount.dispatchEvent(new Event("input",{bubbles:true}));amount.value="100000000";amount.dispatchEvent(new Event("input",{bubbles:true}));});
 await act(async()=>resolve({allowed:true,blockers:[]}));
 expect(host.querySelector<HTMLButtonElement>('button[value="simpan"]')!.disabled).toBe(true);
});
it("keeps the original request key when a lost response reloads a newer asset revision",async()=>{
 await render();const key=host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value;
 await act(async()=>root.unmount());root=createRoot(host);await render(1,10000000);
 expect(host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value).toBe(key);
 expect(host.querySelector<HTMLInputElement>('input[name="revision"]')!.value).toBe("1");
 await act(async()=>{host.querySelector<HTMLTextAreaElement>('textarea[name="alasan"]')!.value='Lost response';host.querySelector<HTMLButtonElement>('button[value="periksa"]')!.click();});
 expect(fixture.commit).toHaveBeenCalledTimes(1);
 const submitted=fixture.commit.mock.calls[0][0] as FormData;
 expect(submitted.get("draft_key")).toBe(key);expect(submitted.get("tindakan")).toBe("periksa");
 expect(fixture.preview).not.toHaveBeenCalled();
});
