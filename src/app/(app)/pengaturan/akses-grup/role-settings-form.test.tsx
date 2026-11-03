// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("./actions", () => ({ saveRoleSettings: vi.fn() }));
import { NewRoleSettingsForm } from "./newRoleSettingsForm";
import { ROLE_ACCESS_CATALOG, type RoleAccessConfig } from "@/lib/role-access-catalog";
let root: Root, host: HTMLDivElement;
const config: RoleAccessConfig = {role:"STAFF",revision:"a".repeat(32),source:"defaults",modules:["klinik","kasir"],capabilities:{all_branches:false,create_accounts:false},audit:[],actions:{source:"legacy",allowed:["bank.cash_entry.view_history"]},action_catalog:[{id:"bank.cash_entry.view_history",label:"Lihat riwayat kas",group:"Kas & Bank",enforced:true},{id:"people.simpanKaryawan",label:"Tambah karyawan",group:"Karyawan",enforced:true},{id:"bank.cash_transfer.create",label:"Buat transfer",group:"Kas & Bank",enforced:false}]};
beforeEach(() => {Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async () => {await act(async () => root.unmount());host.remove();});
it("renders real durable catalog and explicit all-settings reset without fictional action switches", async () => {
 await act(async () => root.render(<NewRoleSettingsForm userId="owner-a" config={config} canEdit />));
 expect(host.querySelectorAll('input[name^="mod_"]')).toHaveLength(17);
 for(const m of ROLE_ACCESS_CATALOG) expect(host.querySelector(`input[name="mod_${m.id}"]`)).not.toBeNull();
 expect(host.querySelector<HTMLInputElement>('input[name="requestKey"]')!.value).toMatch(/^[a-f0-9-]{36}$/);
 expect(host.querySelector<HTMLInputElement>('input[name="expected_revision"]')!.value).toBe(config.revision);
 expect(host.textContent).toContain("buka menu"); expect(host.textContent).toContain("SEMUA");
 expect(host.querySelector('input[name="confirm_reset"]')).not.toBeNull();
 expect(host.querySelector('input[name="discount"]')).toBeNull();
});
it("restores draft and key on remount; role/revision boundaries do not import another draft",async()=>{
 await act(async()=>root.render(<NewRoleSettingsForm key="a" userId="owner-a" config={config} canEdit />));
 const key=host.querySelector<HTMLInputElement>('input[name="requestKey"]')!.value;
 const reason=host.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
 await act(async()=>{reason.value="KEEP DRAFT";reason.dispatchEvent(new Event("input",{bubbles:true}));});
 await act(async()=>root.unmount());root=createRoot(host);
 await act(async()=>root.render(<NewRoleSettingsForm key="b" userId="owner-a" config={{...config,role:"ADMIN"}} canEdit />));
 expect(host.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!.value).toBe("");
 expect(host.querySelector<HTMLInputElement>('input[name="requestKey"]')!.value).not.toBe(key);
 await act(async()=>root.unmount());root=createRoot(host);
 await act(async()=>root.render(<NewRoleSettingsForm key="c" userId="owner-a" config={config} canEdit />));
 expect(host.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!.value).toBe("KEEP DRAFT");
 expect(host.querySelector<HTMLInputElement>('input[name="requestKey"]')!.value).toBe(key);
 await act(async()=>root.unmount());root=createRoot(host);
 await act(async()=>root.render(<NewRoleSettingsForm key="d" userId="owner-a" config={{...config,revision:"b".repeat(32)}} canEdit />));
 expect(host.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!.value).toBe("");
});
it("renders only authoritative enforced business actions, separately from menu and protected ceilings",async()=>{
 await act(async()=>root.render(<NewRoleSettingsForm userId="owner-a" config={config} canEdit />));
 expect(host.querySelectorAll('input[name^="act_"]')).toHaveLength(2);
 expect(host.querySelector<HTMLInputElement>('[name="act_bank.cash_entry.view_history"]')!.checked).toBe(true);
 expect(host.querySelector('[name="act_bank.cash_transfer.create"]')).toBeNull();
 expect(host.textContent).toContain("Lihat riwayat kas");expect(host.textContent).toContain("Tambah karyawan");
 for(const phrase of ["Tindakan bisnis", "Belum tersedia", "belum punya kebijakan tindakan", "tidak menaikkan", "harga", "diskon", "cabang"])expect(host.textContent).toContain(phrase);
 const reason=host.querySelector<HTMLTextAreaElement>('[name="reason"]')!;reason.focus();
 await act(async()=>{reason.value="Tidak kehilangan fokus";reason.dispatchEvent(new Event("input",{bubbles:true}));});
 expect(document.activeElement).toBe(reason);
});
const custom: RoleAccessConfig = {...config,actions:{source:"custom",allowed:["bank.cash_entry.view_history"]}};
it("preserves action draft and identity but never restores reset consent or mode",async()=>{
 await act(async()=>root.render(<NewRoleSettingsForm userId="owner-a" config={custom} canEdit />));
 const key=host.querySelector<HTMLInputElement>('[name="requestKey"]')!.value;
 await act(async()=>{
 host.querySelector<HTMLInputElement>('[name="act_people.simpanKaryawan"]')!.click();
 host.querySelector<HTMLInputElement>('[name="confirm_reset"]')!.click();
 const select=host.querySelector<HTMLSelectElement>('[name="mode"]')!;select.value="reset";select.dispatchEvent(new Event("change",{bubbles:true}));
 });
 expect(host.textContent).toContain("tindakan bisnis khusus");
 await act(async()=>root.unmount());root=createRoot(host);
 await act(async()=>root.render(<NewRoleSettingsForm userId="owner-a" config={custom} canEdit />));
 expect(host.querySelector<HTMLInputElement>('[name="act_people.simpanKaryawan"]')!.checked).toBe(true);
 expect(host.querySelector<HTMLInputElement>('[name="requestKey"]')!.value).toBe(key);
 expect(host.querySelector<HTMLInputElement>('[name="confirm_reset"]')!.checked).toBe(false);
 expect(host.querySelector<HTMLSelectElement>('[name="mode"]')!.value).toBe("custom");
});
it("read-only viewers cannot edit any action and unavailable-only catalogue offers no fake switches",async()=>{
 await act(async()=>root.render(<NewRoleSettingsForm userId="viewer" config={{...config,actions:{source:"custom",allowed:[]},action_catalog:config.action_catalog.filter(a=>!a.enforced)}} canEdit={false} />));
 expect(host.querySelectorAll('input[name^="act_"]')).toHaveLength(0);
 expect(host.querySelector('fieldset')!.disabled).toBe(true);
 expect(host.querySelector('button[type="submit"]')).toBeNull();
 expect(host.textContent).toContain("Belum tersedia");
});
