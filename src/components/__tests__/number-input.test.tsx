// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { NumberInput } from "../NumberInput";
import { NumericInputSafety } from "../NumericInputSafety";
import { TransactionDraft, transactionDraftName } from "../TransactionDraft";
import { useClinicDraft } from "../useClinicDraft";

let root: Root, host: HTMLDivElement;
beforeEach(() => { sessionStorage.clear(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host=document.createElement("div");document.body.append(host);root=createRoot(host); });
afterEach(async () => { await act(async()=>root.unmount());host.remove(); });
const edit = async (el: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(el,value);
  el.dispatchEvent(new Event("input", {bubbles:true}));
});
it("keeps wheel values stable and leaves scroll events uncancelled for focused and unfocused controls", async () => {
  await act(async()=>root.render(<><NumericInputSafety/><NumberInput defaultValue={15000}/><input type="number" defaultValue="24"/></>));
  for (const el of host.querySelectorAll("input")) {
    for (const focus of [true,false]) {
      await act(async()=>{ if(focus)el.focus();else el.blur(); });
      const wheel=new WheelEvent("wheel",{bubbles:true,cancelable:true,deltaY:100});
      await act(async()=>el.dispatchEvent(wheel));
      expect(el.value).toBe(el.defaultValue);expect(wheel.defaultPrevented).toBe(false);expect(document.activeElement).not.toBe(el);
    }
  }
});
it("preserves exact signed decimals, blanks, zero, native min/max/step validation and resets", async () => {
  await act(async()=>root.render(<form><NumberInput name="amount" defaultValue="-1234567.0012300" step="any"/><NumberInput name="percent" min={0} max={100} step="0.01" required defaultValue={10}/></form>));
  const form=host.querySelector("form")!, amount=host.querySelector<HTMLInputElement>('[name="amount"]')!, percent=host.querySelector<HTMLInputElement>('[name="percent"]')!;
  expect(host.querySelector('[data-number-display="amount"]')!.textContent).toBe("-1.234.567,0012300");
  expect(new FormData(form).get("amount")).toBe("-1234567.0012300");
  await edit(amount, "0");expect(new FormData(form).get("amount")).toBe("0");
  await edit(amount, "");expect(new FormData(form).get("amount")).toBe("");
  for(const value of ["101","-1","1.001",""]) { await edit(percent,value);expect(percent.checkValidity()).toBe(false); }
  await edit(percent,"12.34");expect(percent.checkValidity()).toBe(true);
  await act(async()=>{form.reset();await new Promise(resolve=>setTimeout(resolve,0));});expect(amount.value).toBe("-1234567.0012300");
  expect(host.querySelector('[data-number-display="amount"]')!.textContent).toBe("-1.234.567,0012300");
});
it("tracks controlled corrections and native draft restoration while retaining refs", async () => {
  const ref=React.createRef<HTMLInputElement>();
  function Harness(){ const [value,setValue]=useState(1000000);return <><NumberInput ref={ref} name="qty" value={value} step="any" onChange={event=>setValue(Number(event.target.value))}/><button onClick={()=>setValue(15000)}>Cancel</button></>; }
  await act(async()=>root.render(<Harness/>));
  await edit(ref.current!,"24000.125");expect(host.querySelector('[data-number-display="qty"]')!.textContent).toBe("24.000,125");
  await act(async()=>host.querySelector("button")!.click());expect(ref.current!.value).toBe("15000");
  expect(host.querySelector('[data-number-display="qty"]')!.textContent).toBe("15.000");
});
it("leaves dynamic text identifiers and dates unchanged", async () => {
  await act(async()=>root.render(<form><NumberInput type="text" name="phone" defaultValue="081234567890"/><NumberInput type="date" name="date" defaultValue="2026-10-24"/></form>));
  expect(host.querySelectorAll(".numeric-field")).toHaveLength(0);
  expect(new FormData(host.querySelector("form")!).get("phone")).toBe("081234567890");
});

it.each(["transaction", "clinic"])("shows the exact uncontrolled amount restored by %s drafts", async kind => {
  const key=kind==="transaction"?transactionDraftName("owner","transaction","numeric-test"):"vetos:clinic-draft:v1:owner:numeric-test";
  sessionStorage.setItem(key,JSON.stringify({version:1,savedAt:Date.now(),requestKey:"request",fields:{amount:"1234567.125"},snapshot:{}}));
  function Clinic(){const draft=useClinicDraft({userId:"owner",scope:"numeric-test",requestKey:"request",snapshot:{},restore:()=>{}});return <form ref={draft.attachForm}><NumberInput name="amount" defaultValue="10" step="any"/></form>;}
  await act(async()=>root.render(kind==="transaction"?<form><TransactionDraft userId="owner" domain="transaction" scope="numeric-test" requestKey="request"/><NumberInput name="amount" defaultValue="10" step="any"/></form>:<Clinic/>));
  expect(new FormData(host.querySelector("form")!).get("amount")).toBe("1234567.125");
  expect(host.querySelector('[data-number-display="amount"]')!.textContent).toBe("1.234.567,125");
});
