// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: () => null }));
import { ItemTable, PembayaranForm } from "@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";
const id = "package";
const material = { deskripsi:"Internal material",item_id:"sku",qty:2,harga:5000,satuan:"pcs",source_invoice_item_id:"material-source",package_item_id:id,package_qty:1 };
const service = { deskripsi:"Internal service",item_id:"service",qty:1,harga:290000,satuan:"x",source_invoice_item_id:"service-source",package_item_id:id,package_qty:1 };
const props = { visitId:"visit",requestKey:"request",targetInvoiceId:"invoice",editMode:true,catatanResep:null,masterObat:[],masterJasa:[],packages:[{id,name:"Saved package",componentIds:[]}],initialObat:[material],initialJasa:[service],
  patient:{photo:null,name:"Fiction",species:"Cat",owner:"Fiction",phone:"",address:"",dokter:"Doctor",jenisLayanan:"Klinik",noInvoice:"INV",tanggal:"2026-11-02"},
  bekal:{promos:[],aturanDiskon:[],golonganPersen:0,infoBarang:{},vouchers:[],hariIni:"2026-11-02",customerId:null,categoryId:null,poinSaldo:0,rupiahPerPoin:1} };
it("pending package quantity can be adjusted while sealed performers and package origin remain locked", () => {
  const itemProps={title:"OBAT",icon:"pill",color:"black",rows:[material,service],setRows:vi.fn(),master:[],listId:"pending",packages:props.packages,sealedPerformers:true,packageQuantityLocked:false,onPackageQty:vi.fn()};
  const host=document.createElement("div");host.innerHTML=renderToStaticMarkup(<ItemTable {...itemProps} />);
  expect(host.querySelector('input[aria-label="Jumlah paket Saved package"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="Lepas paket Saved package"]')).toBeNull();
});
it("saved mixed component discounts show the exact amount, not the first component percent for the whole package", () => {
  const host=document.createElement("div");
  host.innerHTML=renderToStaticMarkup(<PembayaranForm {...props} initialObat={[{...material,diskon_persen:10}]} initialJasa={[{...service,diskon_persen:0}]} />);
  expect(host.querySelector('tr[data-paket]')?.textContent).toContain("Rp 299.000");
  expect(host.querySelector('tr[data-paket]')?.textContent).toContain("Diskon campuran Rp 1.000");
  expect(host.querySelector('input[aria-label="Diskon Saved package"]')).toBeNull();
});
it.each([false,true])("recovered package display stays unified without changing an uncertain source payload, legacy=%s", async legacy => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();
  const oldMaterial={...material},oldService={...service};
  if(legacy){delete (oldMaterial as Partial<typeof material>).package_item_id;delete (oldMaterial as Partial<typeof material>).package_qty;delete (oldService as Partial<typeof service>).package_item_id;delete (oldService as Partial<typeof service>).package_qty;}
  const snapshot={sourceVersion:legacy?"old-source":"stable",obat:[oldMaterial],jasa:[oldService],discount:0,metode:"Tunai",reason:"",voucher:"",poinPakai:0,bayar:0,salesperson:"",mixed:false,splitPayments:[{method:"Tunai",amount:0},{method:"Transfer",amount:0}],demoEnabled:false,demoPolicyId:"",demoEmployees:[]};
  sessionStorage.setItem("vetos:clinic-draft:v1:recovery:payment:visit:invoice",JSON.stringify({version:1,savedAt:Date.now(),requestKey:"unchanged-key",fields:{},snapshot}));
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(<PembayaranForm {...props} draftUserId="recovery" draftScope="payment:visit:invoice" sourceVersion="stable" />));
    expect(host.querySelectorAll('tr[data-paket]')).toHaveLength(1);
    expect(host.querySelector('tr[data-paket]')?.textContent).not.toContain("Internal material");
    expect(host.querySelector('tr[data-paket]')?.textContent).toContain("Rp 300.000");
    const payload=JSON.parse(host.querySelector<HTMLInputElement>('input[name="items"]')!.value);
    expect(payload).toEqual([{...oldMaterial,jenis:"obat"},{...oldService,jenis:"jasa"}]);
    if(legacy)expect(host.textContent).toContain("Data tagihan sumber berubah");
    else{
      await act(async()=>host.querySelector<HTMLElement>('[aria-label="Hapus paket Saved package"]')!.click());
      expect(JSON.parse(host.querySelector<HTMLInputElement>('input[name="items"]')!.value)).toEqual([]);
    }
  }finally{await act(async()=>root.unmount());host.remove();sessionStorage.clear();}
});
