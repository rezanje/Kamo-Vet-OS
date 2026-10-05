import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/useClinicDraft", () => ({ useClinicDraft: ({ requestKey }: {requestKey: string}) => ({ submissionKey: requestKey, submit: vi.fn(), capture: vi.fn(), attachForm: vi.fn(), discard: vi.fn(), recovered: false, storageError: "", saveError: "" }) }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: () => null }));
vi.mock("../../app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
vi.mock("@/lib/tanggal", async () => await import("../tanggal"));
vi.mock("@/lib/metode-bayar", async () => await import("../metode-bayar"));
vi.mock("@/lib/promo-hitung", async () => await import("../promo-hitung"));
vi.mock("@/lib/harga-golongan", async () => await import("../harga-golongan"));
vi.mock("@/lib/voucher", async () => await import("../voucher"));
vi.mock("@/lib/tagihan-klinik", () => ({ hargaNetto: (r: {harga:number})=>r.harga, nilaiBaris: (r: {qty:number;harga:number})=>r.qty*r.harga }));
import { ItemTable, PembayaranForm } from "../../app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";
function find(node: React.ReactNode, type: string): React.ReactElement<Record<string, unknown>> | undefined {
  if (!React.isValidElement<Record<string, unknown>>(node)) return;
  if (node.type === type) return node;
  for (const child of React.Children.toArray(node.props.children as React.ReactNode)) { const result=find(child,type);if(result)return result; }
}
const row={deskripsi:"Fiction medicine",qty:2,harga:1000,item_id:"item",satuan:"PCS"};
const master=[{id:"item",code:"FIC",name:"Fiction medicine",unit:"PCS",harga:1000,units:[{unit:"PCS",factor:1,sell_price:1000,buy_price:500},{unit:"box",factor:10,sell_price:9000,buy_price:5000}]}];
describe("clinic payment units",()=>{
  it("changes manual unit and branch unit price while preserving entered quantity",()=>{
    let updated: typeof row[]=[];
    const tree=ItemTable({title:"OBAT",icon:"pill",color:"black",rows:[row],setRows:r=>{updated=r as typeof row[];},master,listId:"test",allowUnits:true});
    const select=find(tree,"select");expect(select).toBeDefined();
    (select!.props.onChange as (event:unknown)=>void)({target:{value:"box"}});
    expect(updated[0]).toMatchObject({satuan:"box",harga:9000,qty:2});
  });
  it.each([{prescription_item_id:"prescribed"},{recipe_id:"recipe",satuan:"racikan"},{terkunci:true}])("preserves sealed prescription, compound and automatic units (%j)",patch=>{
    const tree=ItemTable({title:"OBAT",icon:"pill",color:"black",rows:[{...row,...patch}],setRows:()=>{},master,listId:"test",allowUnits:true});
    expect(find(tree,"select")).toBeUndefined();
  });
});
const props={visitId:"visit",requestKey:"request",patient:{photo:null,name:"Fiction",species:"Kucing",owner:"Owner",phone:"",address:"",dokter:"Doctor",jenisLayanan:"Grooming",noInvoice:"(baru)",tanggal:"2026-10-05"},initialObat:[],initialJasa:[],catatanResep:null,
  bekal:{promos:[],aturanDiskon:[],golonganPersen:0,infoBarang:{},vouchers:[],hariIni:"2026-10-05",customerId:null,categoryId:null,poinSaldo:0,rupiahPerPoin:1},
  salespeople:[{id:"groomer",nama:"Fiction Groomer",jabatan:"Groomer"}],initialSalespersonId:"groomer"};
describe("clinic salesperson form",()=>{
  it("offers eligible staff on a new invoice",()=>{
    const html=renderToStaticMarkup(React.createElement(PembayaranForm,props));
    expect(html).toContain('name="salesperson_id"');expect(html).toContain('value="groomer" selected=""');
  });
  it("enables new medicine unit choices only after the database capability is available",()=>{
    const unitProps={...props,initialObat:[row],masterObat:master};
    const before=renderToStaticMarkup(React.createElement(PembayaranForm,unitProps));
    const after=renderToStaticMarkup(React.createElement(PembayaranForm,{...unitProps,manualUnitsEnabled:true}));
    expect(before).not.toContain('aria-label="Satuan Fiction medicine"');
    expect(after).toContain('aria-label="Satuan Fiction medicine"');
  });
  it("keeps posted invoice attribution read-only during correction",()=>{
    const html=renderToStaticMarkup(React.createElement(PembayaranForm,{...props,editMode:true,sealedSalespersonName:"Original Doctor"}));
    expect(html).not.toContain('name="salesperson_id"');expect(html).toContain("Original Doctor");
  });
});
