// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ rpc: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "cashier" } } }) }, rpc: boundary.rpc }) }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: boundary.push, refresh: boundary.refresh }) }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn(() => { throw new Error("Never post a ward through outpatient action"); }) }));
import { InpatientCashier } from "@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier";
import type { InpatientCashierData } from "@/lib/inpatient-cashier";
const patient = { photo: null, name: "Pasien Fiktif", species: "Kucing", owner: "Pemilik Fiktif", phone: "080000000000", address: "Alamat fiktif", dokter: "Dokter Fiktif", jenisLayanan: "Rawat Inap", noInvoice: "(baru)", tanggal: "01/11/2026" };
const performers = { doctor_id:"doctor", doctor_name:"Dokter Fiktif", staff_id:null, staff_name:null };
const accounts = [ {method:"Tunai",code:"110003",name:"Kas Fiktif",bank:null,number:null}, {method:"Transfer",code:"120002",name:"Rekening Transfer Fiktif",bank:"Bank A Fiktif",number:"000111"}, {method:"Debit",code:"1103",name:"Rekening Debit Fiktif",bank:"Bank B Fiktif",number:"000222"} ];
const data: InpatientCashierData = { tax_settings:{mode_pkp:true,ppn_rate:10}, snapshot:"strict-source-snapshot", rows:[{id:"source-rx",item_id:"sku",nama_obat:"Jasa Fiktif",qty:1,harga:150000,satuan:"pcs",jenis:"jasa",service_performers:performers}],
  history:[{id:"issued",invoice_no:"VET_FIKTIF-001",total:330000,received:60000,dp_amount:60000,paid_status:"DP",correction_pending:false,lines:[]}], receipts:[], applications:[],
  quote:{token:"read-quote",remaining:335000,pending:165000,debt:270000,credit:100000,subtotal:150000,tax:15000,amount:0,excess:0,accounts} };
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); sessionStorage.clear(); boundary.rpc.mockReset(); boundary.push.mockReset(); boundary.refresh.mockReset(); host=document.createElement("div");document.body.append(host);root=createRoot(host); });
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const render=async(value=data)=>act(async()=>root.render(<InpatientCashier data={value} patient={patient} visitId="visit" recordId="stay" requestKey="stable-request" masterObat={[]} masterJasa={[{id:"sku",code:"F",name:"Jasa Fiktif",unit:"pcs",harga:150000}]} ppnRate={10} minDpPercent={50} bolehTerobos={false}/>));
async function input(label:string,value:string){await act(async()=>{const el=host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));});}
async function click(label:string){await act(async()=>{const el=[...host.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.getAttribute("aria-label")===label||button.textContent?.trim()===label)!;el.click();});}
async function submit(){await act(async()=>{host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});}
const saved={data:{status:"SAVED",visit_id:"visit",record_id:"stay",invoice_id:"exact-new-invoice",receipt_id:"exact-receipt"},error:null};
it("edited pending cart reaches the REAL existing atomic server action with exact snapshot, reason, split methods and sealed original performer",async()=>{
  await render(); await input("Jumlah Jasa Fiktif","2");
  expect(host.textContent).toContain("Biaya tahap baru (belum terbit)Rp 330.000");
  expect(host.textContent).toContain("Sisa yang Harus DibayarRp 500.000");
  expect(host.textContent).toContain("DP lanjutan opsional: Rp 250.000");
  await input("Alasan revisi keranjang","Koreksi jumlah fiktif");await input("Jumlah Bayar","100000");
  await act(async()=>host.querySelector<HTMLInputElement>('[type="checkbox"]')!.click());
  await input("Nominal pembayaran 2","400000");
  boundary.rpc.mockResolvedValue(saved);await submit();
  expect(boundary.rpc).toHaveBeenCalledTimes(1);
  expect(boundary.rpc).toHaveBeenCalledWith("clinic_save_inpatient_cashier",expect.objectContaining({p_record_id:"stay",p_visit_id:"visit",p_request_key:"stable-request",p_snapshot:"strict-source-snapshot",p_reason:"Koreksi jumlah fiktif",p_parts:[{method:"Tunai",amount:100000},{method:"Transfer",amount:400000}],p_rows:[expect.objectContaining({id:"source-rx",item_id:"sku",qty:2,harga:150000,service_performers:performers})],p_overpayment_ack:null}));
  expect(boundary.push).toHaveBeenCalledWith("/klinik/pembayaran/visit?success=transaksi&receipt=exact-receipt&invoice=exact-new-invoice");
  expect(boundary.refresh).toHaveBeenCalledTimes(1);
});
it("uses outpatient noncash autofill, actual destination and current edited balance, without subtracting old DP or credit twice",async()=>{
  await render();await input("Jumlah Bayar","30000");await click("Transfer");
  expect(host.querySelector<HTMLInputElement>('[aria-label="Jumlah Bayar"]')!.value).toBe("335000");
  expect(host.textContent).toContain("Bank A Fiktif");expect(host.textContent).toContain("000111");
  await input("Jumlah Jasa Fiktif","2");expect(host.querySelector<HTMLInputElement>('[aria-label="Jumlah Bayar"]')!.value).toBe("500000");
  await input("Jumlah Bayar","80000");await click("Debit");expect(host.querySelector<HTMLInputElement>('[aria-label="Jumlah Bayar"]')!.value).toBe("500000");
  expect(host.textContent).toContain("Bank B Fiktif");expect(host.textContent).toContain("000222");expect(host.querySelector('[data-payment-method="Kartu"]')).toBeNull();
  boundary.rpc.mockResolvedValue(saved);await submit();expect(boundary.rpc.mock.calls[0][1].p_parts).toEqual([{method:"Debit",amount:500000}]);
});
it("retries the exact receipt snapshot only after a fresh explicit owner-credit token, never as change/refund",async()=>{
  await render();await input("Jumlah Bayar","400000");
  const quote={...data.quote,token:"fresh-token",amount:400000,excess:65000};
  boundary.rpc.mockResolvedValueOnce({data:{status:"OVERPAYMENT_CONFIRM_REQUIRED",quote},error:null}).mockResolvedValueOnce(saved);
  await submit();expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Lebih Rp 65.000 disimpan sebagai saldo pemilik");
  expect(boundary.rpc.mock.calls[0][1].p_overpayment_ack).toBeNull();expect(boundary.push).not.toHaveBeenCalled();
  await click("Setuju, simpan saldo pemilik");
  expect(boundary.rpc.mock.calls[1][1]).toEqual({...boundary.rpc.mock.calls[0][1],p_overpayment_ack:"fresh-token"});
  expect(boundary.push).toHaveBeenCalledTimes(1);expect(host.textContent).not.toContain("Kembalian");
});
it("cancelling and changing a method cannot reuse the prior owner-credit acknowledgment",async()=>{
  await render();await input("Jumlah Bayar","400000");boundary.rpc.mockResolvedValue({data:{status:"OVERPAYMENT_CONFIRM_REQUIRED",quote:{...data.quote,token:"stale-token",amount:400000,excess:65000}},error:null});
  await submit();await click("Batal");await click("Transfer");await submit();
  expect(boundary.rpc.mock.calls[1][1].p_overpayment_ack).toBeNull();expect(boundary.rpc.mock.calls[1][1].p_parts).toEqual([{method:"Transfer",amount:335000}]);
});
it("keeps save-without-payment available when the authoritative quote has no mapped accounts",async()=>{
  await render({...data,quote:{...data.quote,accounts:[]}});
  expect(host.querySelector<HTMLInputElement>('[aria-label="Jumlah Bayar"]')!.value).toBe("");
  boundary.rpc.mockResolvedValue(saved);await submit();
  expect(boundary.rpc).toHaveBeenCalledTimes(1);
  expect(boundary.rpc.mock.calls[0][1].p_parts).toEqual([]);
  expect(boundary.rpc.mock.calls[0][1].p_rows).toEqual([expect.objectContaining({id:"source-rx",qty:1,harga:150000})]);
  expect(boundary.push).toHaveBeenCalledTimes(1);
});
it("preserves save-later and compound warning while a database refusal never reports success",async()=>{
  await render({...data,compound_pending:true});await submit();expect(boundary.rpc).not.toHaveBeenCalled();
  await act(async()=>host.querySelector<HTMLInputElement>('[aria-label="Konfirmasi racikan belum siap"]')!.click());
  boundary.rpc.mockResolvedValue({data:null,error:{message:"BMHP-bearing SKU replacement blocked"}});await submit();
  expect(boundary.rpc.mock.calls[0][1].p_parts).toEqual([]);expect(boundary.push).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
