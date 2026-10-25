// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const actions=vi.hoisted(()=>({preview:vi.fn(),validate:vi.fn(),save:vi.fn()}));
vi.mock("@/app/(app)/crm/promo/impor/actions",()=>({
  previewPromoExcel:(data:FormData)=>actions.preview(data),
  validatePromoDraft:(rows:unknown)=>actions.validate(rows),
  savePromoExcelBatch:(input:unknown)=>actions.save(input),
}));
import { PromoImportWorkspace } from "@/app/(app)/crm/promo/impor/PromoImportWorkspace";

let host:HTMLDivElement,root:Root;
const row={line:2,code:"SKU-A",unit:"PCS",discount_type:"percent",discount_value:"10",item_name:"Fiction item",error:null};
async function click(text:string) {await act(async()=>{[...host.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent?.includes(text))!.click();});}
async function fill(element:HTMLInputElement,value:string) {
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(element,value);
    element.dispatchEvent(new Event("input",{bubbles:true}));
    element.dispatchEvent(new Event("change",{bubbles:true}));
  });
}
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  actions.preview.mockReset().mockResolvedValue({rows:[row],valid:true});
  actions.validate.mockReset().mockImplementation(async(rows:typeof row[])=>({rows:rows.map(value=>({...value,item_name:"Fiction item",error:null})),valid:true}));
  actions.save.mockReset().mockResolvedValue({ok:true,message:"1 promo berhasil disimpan"});
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<PromoImportWorkspace branches={[{id:"branch-1",name:"Fiction branch"}]} today="2026-10-25"/>));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});

it("previews Excel, requires revalidation after row edits and sends the edited unit discount once",async()=>{
  const fileInput=host.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file=new File(["fixture"],"promo.xlsx",{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  Object.defineProperty(fileInput,"files",{configurable:true,value:[file]});
  await act(async()=>fileInput.dispatchEvent(new Event("change",{bubbles:true})));
  await click("Baca dan preview");
  expect(host.textContent).toContain("Fiction item");
  const saveButton=[...host.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent?.includes("Simpan seluruh batch"))!;
  expect(saveButton.disabled).toBe(false);
  await fill(host.querySelector<HTMLInputElement>('[aria-label="Nilai diskon baris 2"]')!,"15");
  expect(saveButton.disabled).toBe(true);
  await click("Validasi ulang");
  expect(actions.validate).toHaveBeenCalledWith([expect.objectContaining({discount_value:"15"})]);
  await fill(host.querySelector<HTMLInputElement>('input[maxlength="40"]')!,"Promo test");
  await fill(host.querySelectorAll<HTMLInputElement>('input[type="date"]')[1],"2026-10-31");
  await act(async()=>host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click());
  await click("Simpan seluruh batch");
  expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({
    name:"Promo test",branchIds:["branch-1"],rows:[expect.objectContaining({code:"SKU-A",discount_value:"15"})],
  }));
  expect(host.textContent).toContain("1 promo berhasil disimpan");
  expect(saveButton.disabled).toBe(true);
});
