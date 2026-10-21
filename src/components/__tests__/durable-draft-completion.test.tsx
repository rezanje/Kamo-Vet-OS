// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({query:""}));
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams(state.query)}));
import { TransactionDraftComplete } from "../LocalTransactionDraft";
let root:Root,host:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();state.query="";host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it("acknowledges durable posting identity on a destination without the original form",async()=>{
 sessionStorage.setItem("vetos:correction-key:v1:owner:bank-reconciliation-create","committed");
 sessionStorage.setItem("vetos:correction-key:v1:other:bank-reconciliation-create","committed");
 state.query="draft_scope=bank-reconciliation-create&draft_done=committed";
 await act(async()=>root.render(<TransactionDraftComplete userId="owner"/>));
 expect(sessionStorage.getItem("vetos:correction-key:v1:owner:bank-reconciliation-create")).toBeNull();
 expect(sessionStorage.getItem("vetos:correction-key:v1:other:bank-reconciliation-create")).toBe("committed");
});
it("keeps an unconfirmed or newer durable identity",async()=>{
 sessionStorage.setItem("vetos:correction-key:v1:owner:bank-reconciliation-create","newer");
 state.query="draft_scope=bank-reconciliation-create&draft_done=old";
 await act(async()=>root.render(<TransactionDraftComplete userId="owner"/>));
 expect(sessionStorage.getItem("vetos:correction-key:v1:owner:bank-reconciliation-create")).toBe("newer");
});
