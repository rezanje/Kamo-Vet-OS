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
import { simpanRekamMedis } from "@/app/(app)/klinik/rekam-medis/[visitId]/actions";
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
import { ItemTable, PembayaranForm } from "@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";
import { CatatanForm } from "@/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm";
import { addDailyLogPos } from "@/app/(app)/klinik/rawat-inap/actions";

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
const gauze = { ...base, id: "gauze", name: "Kasa steril", item_type: "Persediaan", unit: "lembar", units: [{ unit: "lembar", factor: 1, sell_price: 10000, buy_price: 5000 }] };
const common = {
  serviceStaff: [{id:"doctor-a",nama:"Dokter A",jabatan:"Dokter Hewan"},{id:"staff-a",nama:"Perawat A",jabatan:"Paramedis"}],
  requestKey: "request", draftUserId: "owner", items: [vaccine, food, gauze], jasaItems: [service], tindakanItems: [action],
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

it.each(['exam', 'inpatient'])('%s compound requires a composition path instead of offering direct finished-stock use', async kind => {
  await render(kind); await tab('Racikan');
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
  const selects=()=>[...host.querySelectorAll<HTMLSelectElement>('select')].filter(select=>select.closest('fieldset') && [...select.options].some(option=>option.value==="doctor-a"));
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
  {deskripsi:'Jasa tersimpan',qty:1,harga:100,prescription_item_id:'source',salesperson_id:'doctor-a',salesperson_name:'Penjual Saat Resep',service_performers:{version:1,doctor_id:'doctor-a',doctor_name:'Dokter Saat Transaksi',staff_id:null}},
  {deskripsi:'Jasa lama',qty:1,harga:100,prescription_item_id:'legacy',service_performers:null},
 ]} serviceStaff={common.serviceStaff} cashierName="Kasir Login" catatanResep={null} bekal={{promos:[],aturanDiskon:[],golonganPersen:0,infoBarang:{},vouchers:[],hariIni:'2026-10-23',customerId:null,categoryId:null,poinSaldo:0,rupiahPerPoin:1}} />));
 expect(host.querySelector('[name=salesperson_id]')).toBeNull();
 expect(host.textContent).toContain('Kasir Login');expect(host.textContent).toContain('Dokter Saat Transaksi');
 expect(host.textContent).toContain('Penjual Saat Resep');
 expect(host.querySelector('[aria-label="Penjual Jasa tersimpan"]')).toBeNull();
 expect(host.querySelector('[aria-label="Penjual Jasa lama"]')).not.toBeNull();
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

it.each(['exam','inpatient'])('K02 %s ordinary service rows (not TINDAKAN) carry no BMHP editor', async kind => {
  await render(kind); await tab("Jasa");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Tambah Konsultasi"]')!.click());
  expect(host.querySelector('input[aria-label="Tambah BMHP Konsultasi"]')).toBeNull();
  expect(host.querySelector('button[aria-label="Ubah BMHP Konsultasi"]')).toBeNull();
  expect(cart().find((item: { item_id: string }) => item.item_id === 'consult')).not.toHaveProperty('bmhp');
});

async function chooseBmhp(label: string, query: string) {
  const picker = host.querySelector<HTMLInputElement>(`input[aria-label="Tambah BMHP ${label}"]`)!;
  expect(picker).toBeTruthy();
  await act(async () => {
    picker.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(picker, query);
    picker.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  await act(async () => picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
}

it.each(['exam','inpatient'])('K02 %s composes two BMHP materials before adding an action and reopens its persisted composition', async kind => {
  await render(kind); await tab('Tindakan');
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Tambah Steril"]')!.click());
  expect(host.textContent).toContain('Komposisi BMHP tindakan');
  expect(cart()).toHaveLength(0);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Tambah Steril"]')!.click());
  expect(cart()).toHaveLength(0);
  await chooseBmhp('Steril', 'Makanan');
  await chooseBmhp('Steril', 'Kasa');
  const qty = host.querySelector<HTMLInputElement>('input[aria-label="Jumlah BMHP Kasa steril"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(qty, '2'); qty.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Tambah tindakan Steril ke keranjang"]')!.click());
  expect(cart()).toHaveLength(1);
  expect(cart()[0]).toMatchObject({ item_id: 'steril', jenis: 'jasa', harga: 75000, bmhp: [
    { item_id: 'food', nama: 'Makanan kucing', qty: 1, unit: 'pcs' },
    { item_id: 'gauze', nama: 'Kasa steril', qty: 2, unit: 'lembar' },
  ] });
  expect(host.textContent).toContain('Rp 75.000');
  await act(async () => root.unmount()); root = createRoot(host); await render(kind);
  expect(cart()[0].bmhp).toHaveLength(2);
  const key = cart()[0].key;
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Ubah BMHP Steril"]')!.click());
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Jumlah BMHP Kasa steril"]')?.value).toBe('2');
  const reopenedQty = host.querySelector<HTMLInputElement>('input[aria-label="Jumlah BMHP Kasa steril"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(reopenedQty, '3'); reopenedQty.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Simpan BMHP Steril"]')!.click());
  expect(cart()).toHaveLength(1);
  expect(cart()[0]).toMatchObject({ key, harga: 75000, bmhp: [expect.any(Object), { qty: 3 }] });
});

it.each(['exam','inpatient'])('%s keeps unfinished BMHP composition across reload and blocks premature clinical save', async kind => {
  vi.clearAllMocks();
  await render(kind); await tab('Tindakan');
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Tambah Steril"]')!.click());
  await chooseBmhp('Steril', 'Kasa');
  expect(cart()).toHaveLength(0);
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(kind === 'exam' ? simpanRekamMedis : addDailyLogPos).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Selesaikan komposisi BMHP tindakan');
  await act(async () => root.unmount()); root = createRoot(host); await render(kind);
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Jumlah BMHP Kasa steril"]')?.value).toBe('1');
  expect(cart()).toHaveLength(0);
});

it.each(['exam','inpatient'])('%s records separate clinic sellers for medicine and procedure in its recoverable cart', async kind => {
  await render(kind);
  const foodRow=[...host.querySelectorAll('tr')].find(row=>row.textContent?.includes('Makanan kucing'))!;
  await act(async()=>foodRow.querySelector<HTMLButtonElement>('button')!.click());
  await tab('Tindakan');
  await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Tambah Steril"]')!.click());
  await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Tambah tindakan Steril ke keranjang"]')!.click());
  const medicine=host.querySelector<HTMLSelectElement>('select[aria-label="Penjual Makanan kucing"]');
  const procedure=host.querySelector<HTMLSelectElement>('select[aria-label="Penjual Steril"]');
  expect(medicine).toBeTruthy();expect(procedure).toBeTruthy();
  await act(async()=>{medicine!.value='doctor-a';medicine!.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>{procedure!.value='staff-a';procedure!.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(cart().map((row:{salesperson_id:string})=>row.salesperson_id)).toEqual(['doctor-a','staff-a']);
  await act(async()=>root.unmount());root=createRoot(host);await render(kind);
  expect(cart().map((row:{salesperson_id:string})=>row.salesperson_id)).toEqual(['doctor-a','staff-a']);
});

it('clinic payment records a different salesperson on medicine and procedure lines', async () => {
  await act(async () => root.render(<PembayaranForm visitId="line-seller" requestKey="pay" draftUserId="cashier"
    patient={{...patient, jenisLayanan:'Klinik', noInvoice:'baru', tanggal:'hari ini'}}
    initialObat={[{deskripsi:'Obat A',qty:1,harga:100,item_id:'medicine'}]}
    initialJasa={[{deskripsi:'Tindakan B',qty:1,harga:200,item_id:'procedure'}]}
    serviceStaff={common.serviceStaff} catatanResep={null}
    bekal={{promos:[],aturanDiskon:[],golonganPersen:0,infoBarang:{},vouchers:[],hariIni:'2026-10-27',customerId:null,categoryId:null,poinSaldo:0,rupiahPerPoin:1}} />));
  const medicine = host.querySelector<HTMLSelectElement>('select[aria-label="Penjual Obat A"]');
  const procedure = host.querySelector<HTMLSelectElement>('select[aria-label="Penjual Tindakan B"]');
  expect(medicine).toBeTruthy();
  expect(procedure).toBeTruthy();
  await act(async () => { medicine!.value='doctor-a'; medicine!.dispatchEvent(new Event('change',{bubbles:true})); });
  await act(async () => { procedure!.value='staff-a'; procedure!.dispatchEvent(new Event('change',{bubbles:true})); });
  const lines = JSON.parse(host.querySelector<HTMLInputElement>('[name=items]')!.value);
  expect(lines.map((line:{salesperson_id:string})=>line.salesperson_id)).toEqual(['doctor-a','staff-a']);
});

it('clinic invoice correction displays the stored seller name on a sealed source line', async () => {
  await act(async () => root.render(<PembayaranForm visitId="seller-edit" requestKey="edit" editMode
    patient={{...patient, jenisLayanan:'Klinik', noInvoice:'saved', tanggal:'hari ini'}}
    initialObat={[{deskripsi:'Obat A',qty:1,harga:100,item_id:'medicine',source_invoice_item_id:'old-line',salesperson_id:'doctor-a',salesperson_name:'Nama saat transaksi'}]}
    initialJasa={[]} serviceStaff={common.serviceStaff} catatanResep={null}
    bekal={{promos:[],aturanDiskon:[],golonganPersen:0,infoBarang:{},vouchers:[],hariIni:'2026-10-27',customerId:null,categoryId:null,poinSaldo:0,rupiahPerPoin:1}} />));
  expect(host.textContent).toContain('Penjual: Nama saat transaksi');
  expect(host.querySelector('select[aria-label="Penjual Obat A"]')).toBeNull();
  const lines = JSON.parse(host.querySelector<HTMLInputElement>('[name=items]')!.value);
  expect(lines[0]).toMatchObject({source_invoice_item_id:'old-line',salesperson_id:'doctor-a'});
});
it('clears saved seller and source when a clinic payment line switches SKU',async()=>{
 const Harness=()=>{const [rows,setRows]=React.useState<React.ComponentProps<typeof ItemTable>['rows']>([{deskripsi:'Obat A',qty:1,harga:100,item_id:'sku-a',prescription_item_id:'prescribed',source_invoice_item_id:'original-line',salesperson_id:'doctor-a',salesperson_name:'Original'}]);
  return <><ItemTable title="OBAT" icon="ti-pill" color="purple" rows={rows} setRows={setRows}
   master={[{id:'sku-a',code:'A',name:'Obat A',unit:'pcs',harga:100},{id:'sku-b',code:'B',name:'Obat B',unit:'pcs',harga:200}]}
   listId="switch-sku" serviceStaff={common.serviceStaff}/><input name="rows" readOnly value={JSON.stringify(rows)}/></>;};
 await act(async()=>root.render(<Harness/>));
 const input=host.querySelector<HTMLInputElement>('[aria-label="Nama obat baris 1"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Obat B');input.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(JSON.parse(host.querySelector<HTMLInputElement>('[name=rows]')!.value)[0]).toMatchObject({item_id:'sku-b',prescription_item_id:null,source_invoice_item_id:null,salesperson_id:null,salesperson_name:null});
});

