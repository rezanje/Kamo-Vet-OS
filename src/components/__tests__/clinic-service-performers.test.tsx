// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/actions", () => ({ simpanRekamMedis: vi.fn() }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ addDailyLogPos: vi.fn() }));
vi.mock("@/components/PetPhotoUpload", () => ({ PetPhotoUpload: () => null }));
vi.mock("@/components/PenunjangUpload", () => ({ PenunjangUpload: () => null }));
import { RekamForm } from "@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm";
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
import { PembayaranForm } from "@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";
import { CatatanForm } from "@/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const base = { unit: "pcs", stok: 5, sell_price: 10000 };
const service = { ...base, id: "consult", name: "Konsultasi", item_type: "Jasa" };
const action = { ...base, id: "steril", name: "Steril", sell_price: 75000, item_type: "Jasa", tindakan_kategori: "Operasi" };
const vaccine = { ...base, id: "vaccine", name: "Vaksin", sell_price: 35000, item_type: "Jasa", tindakan_kategori: "Vaksinasi" };
const food = { ...base, id: "food", name: "Makanan kucing", item_type: "Persediaan", units: [{ unit: "pcs", factor: 1, sell_price: 10000, buy_price: 5000 }] };
const common = {
  serviceStaff: [{id:"doctor-a",nama:"Dokter A",jabatan:"Dokter Hewan"},{id:"staff-a",nama:"Perawat A",jabatan:"Paramedis"}],
  requestKey: "request", draftUserId: "owner", items: [vaccine, food], jasaItems: [service], tindakanItems: [action],
  bahanItems: [{ ...base, id: "ingredient", name: "Bahan diizinkan" }],
  racikanItems: [{ ...base, id: "compound", name: "Obat Racik Sirup" }], katalogRacikan: [], bolehManual: true,
};
const patient = { name: "Milo", species: "Kucing", breed: null, noRM: "RM1", owner: "Pemilik", phone: "08123", address: "", photo: null, dokter: "Dokter" };
async function render(kind: string) {
  await act(async () => root.render(kind === "exam"
    ? <RekamForm {...common} visitId="visit" petId="pet" currentWeight={null} dokterOpsi={[]} providerOpsi={[]}
      patient={{ ...patient, tglPeriksa: "13 Oct", dokterId: null, providerId: null, tier: "Umum", keluhan: "Kontrol" }} />
    : <CatatanForm {...common} recordId="inpatient" backHref="/klinik/rawat-inap/inpatient"
      patient={{ ...patient, tglMasuk: "13 Oct", kondisi: "Stabil" }} />));
}
async function tab(name: string) {
  const button = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === name);
  expect(button, `tab ${name}`).toBeDefined();
  await act(async () => button!.click());
}
const cart = () => JSON.parse(host.querySelector<HTMLInputElement>('input[name="resep"]')!.value);

it('outpatient compound requires a composition path instead of offering direct finished-stock use', async () => {
  await render('exam'); await tab('Racikan');
  const search = host.querySelector<HTMLInputElement>('[aria-label="Cari obat racik"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Obat Racik');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const select = host.querySelector<HTMLButtonElement>('[aria-label="Pilih Obat Racik Sirup"]')!;
  expect(select).toBeTruthy();
  await act(async () => select.click());
  expect(host.textContent).toContain('Komposisi racikan');
  expect(host.textContent).not.toContain('Ambil stok obat jadi');
  const addCompound = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent?.includes('Tambah racikan ke keranjang'));
  expect(addCompound?.disabled).toBe(true);
});


it.each(["exam", "inpatient"])("%s retains distinct repeated service rows and explicit empty attribution", async kind => {
  await render(kind); await tab("Jasa");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Tambah Konsultasi"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Tambah Konsultasi"]')!.click());
  expect(cart()).toHaveLength(2);
  expect(new Set(cart().map((row: {key:string}) => row.key)).size).toBe(2);
  expect(cart().map((row: {service_performers:unknown}) => row.service_performers)).toEqual([
    {doctor_id:null,staff_id:null}, {doctor_id:null,staff_id:null},
  ]);
  const expected=cart();
  await act(async()=>root.unmount()); root=createRoot(host); await render(kind);
  expect(cart()).toEqual(expected);
});
it.each(["exam", "inpatient"])("%s offers performers only for services and preserves row overrides on bulk fill", async kind => {
  await render(kind);
  const foodRow=[...host.querySelectorAll("tr")].find(row=>row.textContent?.includes("Makanan kucing"))!;
  await act(async()=>foodRow.querySelector<HTMLButtonElement>("button")!.click());
  expect(cart()[0].service_performers ?? null).toBeNull();
  await tab("Jasa");
  for(let i=0;i<2;i++)await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Tambah Konsultasi"]')!.click());
  const selects=()=>[...host.querySelectorAll<HTMLSelectElement>('select')].filter(select=>[...select.options].some(option=>option.value==="doctor-a"));
  expect(selects()).toHaveLength(3);
  await act(async()=>{selects()[0].value="doctor-a";selects()[0].dispatchEvent(new Event("change",{bubbles:true}));});
  const bulkStaff=[...host.querySelectorAll<HTMLSelectElement>('select')].find(select=>select.closest('fieldset')?.textContent?.includes('Isi pelaksana')&&[...select.options].some(option=>option.value==='staff-a'))!;
  expect(bulkStaff).toBeDefined();
  await act(async()=>{bulkStaff.value='staff-a';bulkStaff.dispatchEvent(new Event('change',{bubbles:true}));});
  const fill=[...host.querySelectorAll('button')].find(button=>button.textContent?.includes('Isi baris jasa kosong'))!;
  await act(async()=>fill.click());
  expect(cart().slice(1).map((row:{service_performers:unknown})=>row.service_performers)).toEqual([{doctor_id:'doctor-a',staff_id:null},{doctor_id:null,staff_id:'staff-a'}]);
});

it('payment shows persisted snapshots and login cashier, without editable global salesperson or source performers',async()=>{
 await act(async()=>root.render(<PembayaranForm visitId="visit" requestKey="pay" patient={{...patient,jenisLayanan:'Klinik',noInvoice:'baru',tanggal:'hari ini'}} initialObat={[]} initialJasa={[
  {deskripsi:'Jasa tersimpan',qty:1,harga:100,prescription_item_id:'source',service_performers:{version:1,doctor_id:'doctor-a',doctor_name:'Dokter Saat Transaksi',staff_id:null}},
  {deskripsi:'Jasa lama',qty:1,harga:100,prescription_item_id:'legacy',service_performers:null},
 ]} serviceStaff={common.serviceStaff} cashierName="Kasir Login" catatanResep={null} bekal={{promos:[],aturanDiskon:[],golonganPersen:0,infoBarang:{},vouchers:[],hariIni:'2026-10-23',customerId:null,categoryId:null,poinSaldo:0,rupiahPerPoin:1}} />));
 expect(host.querySelector('[name=salesperson_id]')).toBeNull();
 expect(host.textContent).toContain('Kasir Login');expect(host.textContent).toContain('Dokter Saat Transaksi');
 expect(host.textContent).toContain('data lama');
 expect([...host.querySelectorAll('fieldset')].filter(field=>field.textContent?.includes('Pelaksana Jasa tersimpan'))).toHaveLength(0);
});

it('payment keeps repeated manual services separate and bulk fill preserves an override and source attribution',async()=>{
 const source={deskripsi:'Jasa sumber',qty:1,harga:100,prescription_item_id:'source',service_performers:{version:1,doctor_id:'saved-doctor',doctor_name:'Dokter Lama',staff_id:null}};
 await act(async()=>root.render(<PembayaranForm visitId="manual" requestKey="pay" draftUserId="cashier" sourceVersion="source" patient={{...patient,jenisLayanan:'Klinik',noInvoice:'baru',tanggal:'hari ini'}} initialObat={[]} initialJasa={[source]} serviceStaff={common.serviceStaff} catatanResep={null} bekal={{promos:[],aturanDiskon:[],golonganPersen:0,infoBarang:{},vouchers:[],hariIni:'2026-10-23',customerId:null,categoryId:null,poinSaldo:0,rupiahPerPoin:1}} />));
 const tables=host.querySelectorAll('table');const serviceSection=tables[1].parentElement!.parentElement!;
 const add=[...serviceSection.querySelectorAll('button')].find(button=>button.textContent?.includes('Tambah'))!;
 for(let i=0;i<2;i++)await act(async()=>add.click());
 const names=[...serviceSection.querySelectorAll<HTMLInputElement>('input[aria-label^="Nama"]')].slice(1);
 for(const input of names)await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Jasa manual');input.dispatchEvent(new Event('input',{bubbles:true}));});
 const manualFields=[...serviceSection.querySelectorAll('fieldset')].filter(field=>field.querySelector('legend')?.textContent?.includes('Pelaksana Jasa manual'));
 await act(async()=>{const select=manualFields[0].querySelector('select')!;select.value='doctor-a';select.dispatchEvent(new Event('change',{bubbles:true}));});
 const bulk=[...serviceSection.querySelectorAll('fieldset')].find(field=>field.textContent?.includes('Isi pelaksana'))!;
 await act(async()=>{const select=bulk.querySelectorAll('select')[1];select.value='staff-a';select.dispatchEvent(new Event('change',{bubbles:true}));});
 await act(async()=>[...serviceSection.querySelectorAll('button')].find(button=>button.textContent?.includes('Isi baris jasa kosong'))!.click());
 const rows=JSON.parse(host.querySelector<HTMLInputElement>('[name=items]')!.value);
 expect(rows).toHaveLength(3);expect(rows[1].key).not.toBe(rows[2].key);
 expect(rows.map((row:{service_performers:unknown})=>row.service_performers)).toEqual([source.service_performers,{doctor_id:'doctor-a',staff_id:null},{doctor_id:null,staff_id:'staff-a'}]);
});

it('S01 payment lets the cashier assign performers to an unassigned clinic service source row, keeping recorded and legacy rows sealed',async()=>{
 const recorded={deskripsi:'Jasa tercatat',qty:1,harga:100,prescription_item_id:'recorded',service_performers:{version:1,doctor_id:'saved-doctor',doctor_name:'Dokter Lama',staff_id:null}};
 const empty={deskripsi:'Jasa kosong',qty:1,harga:100,prescription_item_id:'empty',service_performers:{version:1,doctor_id:null,staff_id:null,doctor_name:null,staff_name:null}};
 const legacy={deskripsi:'Jasa lama',qty:1,harga:100,prescription_item_id:'legacy',service_performers:null};
 await act(async()=>root.render(<PembayaranForm visitId="s01" requestKey="pay" draftUserId="cashier" sourceVersion="source" patient={{...patient,jenisLayanan:'Klinik',noInvoice:'baru',tanggal:'hari ini'}} initialObat={[]} initialJasa={[recorded,empty,legacy]} serviceStaff={common.serviceStaff} catatanResep={null} bekal={{promos:[],aturanDiskon:[],golonganPersen:0,infoBarang:{},vouchers:[],hariIni:'2026-10-23',customerId:null,categoryId:null,poinSaldo:0,rupiahPerPoin:1}} />));
 const fieldsFor=(name:string)=>[...host.querySelectorAll('fieldset')].filter(field=>field.querySelector('legend')?.textContent===`Pelaksana ${name}`);
 expect(fieldsFor('Jasa tercatat')).toHaveLength(0);
 expect(fieldsFor('Jasa lama')).toHaveLength(0);
 expect(fieldsFor('Jasa kosong')).toHaveLength(1);
 const bulk=[...host.querySelectorAll('fieldset')].find(field=>field.textContent?.includes('Isi pelaksana'))!;
 expect(bulk).toBeDefined();
 await act(async()=>{const select=bulk.querySelectorAll('select')[1];select.value='staff-a';select.dispatchEvent(new Event('change',{bubbles:true}));});
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent?.includes('Isi baris jasa kosong'))!.click());
 const rows=JSON.parse(host.querySelector<HTMLInputElement>('[name=items]')!.value);
 expect(rows.map((row:{service_performers:unknown})=>row.service_performers)).toEqual([recorded.service_performers,{doctor_id:null,staff_id:'staff-a'},null]);
 expect(rows.map((row:{prescription_item_id:string})=>row.prescription_item_id)).toEqual(['recorded','empty','legacy']);
});

it.each(['exam','inpatient'])('%s recovers a legacy draft without silently adding performer fields',async kind=>{
 await render(kind);await tab('Jasa');await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Tambah Konsultasi"]')!.click());
 const key=Object.keys(sessionStorage).find(key=>key.includes('clinic-draft')&&key.includes(kind==='exam'?'exam:visit':'inpatient:inpatient'))!;
 expect(key).toBeDefined();const saved=JSON.parse(sessionStorage.getItem(key)!);
 delete saved.snapshot.cart[0].service_performers;sessionStorage.setItem(key,JSON.stringify(saved));
 await act(async()=>root.unmount());root=createRoot(host);await render(kind);
 expect(cart()).toHaveLength(1);expect(cart()[0]).not.toHaveProperty('service_performers');
});
