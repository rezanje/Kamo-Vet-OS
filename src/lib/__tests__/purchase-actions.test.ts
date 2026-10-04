import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc, from: state.from }) }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ prefix: "TB.FIC.", digit: 5 }) }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
import { terimaBarang, recoverPurchaseSubmission } from "../../app/(app)/pembelian/actions";
import { tambahPembelianAset } from "../../app/(app)/keuangan/aset/actions";
import { buatFaktur } from "../../app/(app)/pembelian/faktur/actions";
function form(values: Record<string,string | undefined>) { const f=new FormData();Object.entries(values).forEach(([k,v])=>v !== undefined && f.set(k,v));return f; }
beforeEach(() => { vi.clearAllMocks(); state.from.mockImplementation(() => {throw new Error("Unexpected direct table access");}); });
describe("purchase server action boundaries",()=>{
 it("checks the original receipt result by key after refreshed quantities change",async()=>{
  state.rpc.mockResolvedValue({data:{receipt_id:"receipt-1",no_terima:"TB.FIC.00001"},error:null});
  await expect(recoverPurchaseSubmission(form({request_scope:"receipt:po-1",request_key:"receipt-key"}))).rejects.toThrow("REDIRECT:/pembelian?success_terima=");
  expect(state.rpc).toHaveBeenCalledWith("get_purchase_operation_result",{p_kind:"receipt",p_request_key:"receipt-key"});
  expect(state.from).not.toHaveBeenCalled();
 });
 it("does not report a purchase complete when no committed result exists",async()=>{
  state.rpc.mockResolvedValue({data:null,error:null});
  await expect(recoverPurchaseSubmission(form({request_scope:"invoice",request_key:"invoice-key"}))).rejects.toThrow("REDIRECT:/pembelian/faktur/baru?error=");
  expect(state.revalidate).not.toHaveBeenCalled();
 });
 it("propagates the original key to a cash asset purchase without stale category/period reads",async()=>{
  state.from.mockImplementation((table:string)=>{
   if(table!=="cash_accounts")throw new Error("Unexpected purchase/category read");
   const query={select:()=>query,eq:()=>query,then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:[{coa_code:"1101"}],error:null}).then(resolve)};return query;
  });
  state.rpc.mockResolvedValue({data:"asset-1",error:null});
  await expect(tambahPembelianAset(form({nama:"Fiction machine",category_id:"category-1",tanggal:"2026-10-04",harga:"1000",nilai_sisa:"0",umur_bulan:"48",branch_id:"branch-1",sumber:"Tunai",account_id:"cash-1",request_key:"asset-key"}))).rejects.toThrow("REDIRECT:/keuangan/aset?success=pembelian");
  expect(state.rpc).toHaveBeenCalledWith("create_fixed_asset_purchase",expect.objectContaining({p_request_key:"asset-key",p_harga:1000,p_credit_code:"1101",p_funding:"Tunai"}));
 });
 it("does not claim a saved asset when the atomic RPC fails",async()=>{
  state.from.mockImplementation(()=>{const query={select:()=>query,eq:()=>query,then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:[{coa_code:"1102"}],error:null}).then(resolve)};return query;});
  state.rpc.mockResolvedValue({data:null,error:{message:"ledger unavailable"}});
  await expect(tambahPembelianAset(form({nama:"Fiction machine",category_id:"category-1",harga:"1000",umur_bulan:"48",sumber:"Bank",account_id:"cash-1",request_key:"asset-key"}))).rejects.toThrow("REDIRECT:/keuangan/aset?error=");
 });
 it("posts receipt only through the atomic RPC with the submitted request key",async()=>{
  state.rpc.mockResolvedValue({data:{receipt_id:"receipt-1",no_terima:"TB.FIC.00001",complete:false},error:null});
  const f=form({id:"po-1",request_key:"receipt-key",tanggal:"2026-10-04",rows:'[{"id":"row-1","qty_terima":2}]'});
  await expect(terimaBarang(f)).rejects.toThrow("REDIRECT:/pembelian?success_terima=");
  expect(state.rpc).toHaveBeenCalledWith("receive_purchase_order",expect.objectContaining({p_po_id:"po-1",p_request_key:"receipt-key",p_rows:[{id:"row-1",qty_terima:2}]}));
  expect(state.from).not.toHaveBeenCalled();
 });
 it("reports receipt RPC failure instead of claiming stock was received",async()=>{
  state.rpc.mockResolvedValue({data:null,error:{message:"journal unavailable"}});
  await expect(terimaBarang(form({id:"po-1",request_key:"receipt-key",rows:'[{"id":"row-1","qty_terima":2}]'}))).rejects.toThrow("REDIRECT:/pembelian/po-1/terima?error=");
  expect(state.revalidate).not.toHaveBeenCalled();
 });
 it("rejects missing keys and malformed or duplicate receipt rows before posting",async()=>{
  for(const fields of [{rows:'[]'},{request_key:"k",rows:'{}'},{request_key:"k",rows:'[{"id":"x","qty_terima":1},{"id":"x","qty_terima":1}]'}]) {
   await expect(terimaBarang(form({id:"po-1",...fields}))).rejects.toThrow("REDIRECT:/pembelian/po-1/terima?error=");
  }
  expect(state.rpc).not.toHaveBeenCalled();
 });
 it("recovers a committed invoice before re-reading now exhausted PO quantities",async()=>{
  state.rpc.mockResolvedValue({data:{invoice_id:"inv-1",no_faktur:"FB.FIC.00001"},error:null});
  await expect(buatFaktur(form({po_id:"po-1",request_key:"invoice-key",tanggal:"2026-10-04",jatuh_tempo:"2026-11-04",items:'[{"po_item_id":"row-1","qty":2,"harga":100}]'}))).rejects.toThrow("REDIRECT:/pembelian/faktur?success=");
  expect(state.rpc).toHaveBeenCalledWith("recover_purchase_operation",expect.objectContaining({p_kind:"invoice",p_request_key:"invoice-key",p_payload:expect.objectContaining({po_id:"po-1",items:[{po_item_id:"row-1",qty:2,harga:100}]})}));
  expect(state.from).not.toHaveBeenCalled();
 });
});
