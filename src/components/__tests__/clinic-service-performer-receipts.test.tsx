import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({legacy:false,tanpaDokter:false,grooming:false}));
vi.mock('next/link',()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('not found')}}));
vi.mock('@/lib/rombongan-server',()=>({bacaRombongan:async()=>({tanggal:'2026-10-23',customerName:'Pemilik',baris:[{visitId:'visit',invoiceNo:'INV-1',hewan:'Milo',paidStatus:'Lunas',total:100,sisa:0}]})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({from(table:string){
 const invoice={id:'invoice',invoice_no:'INV-1',subtotal:100,discount:0,tax:0,total:100,dp_amount:0,paid_status:'Lunas',metode_bayar:'Tunai',created_at:'2026-10-23T10:00:00Z',cashier_name:state.legacy?null:'Kasir Saat Transaksi'};
 const visit={id:'visit',poli:state.grooming?'Grooming':'Klinik',doctor_id:state.legacy||state.tanpaDokter?null:state.grooming?'groomer-pj':'dokter-pj',dokter:state.tanpaDokter?null:'PIC Kasus',pets:{name:'Milo',species:'Kucing'},customers:{name:'Pemilik'},branches:{name:'Cabang'}};
 const rows=table==='invoice_items'?[{id:'line',invoice_id:'invoice',deskripsi:'Jasa tersimpan',jenis:'jasa',qty:1,harga:100,service_performers:state.legacy?null:{version:1,doctor_id:'doctor',doctor_name:'Dokter Saat Transaksi',staff_id:'staff',staff_name:'Perawat Saat Transaksi'}}]
  :table==='invoices'?[invoice]:table==='visits'?[visit]:table==='employees'?[{id:'dokter-pj',nama:'Dokter PJ Tersimpan',jabatan:'Dokter Hewan'},{id:'groomer-pj',nama:'Agung Groomer',jabatan:'Groomer'},{id:'doctor',nama:'Dokter Kartu',jabatan:'Dokter'},{id:'staff',nama:'Perawat Kartu',jabatan:'Paramedis'}]:[];
 let from=0,to=Number.MAX_SAFE_INTEGER,exact=false;
 const q={select:(_columns:string,options?:{count?:string})=>{exact=options?.count==='exact';return q;},range:(start:number,end:number)=>{from=start;to=end;return q;},eq:()=>q,is:()=>q,in:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:table==='visits'?visit:table==='invoices'?invoice:null,error:null,count:1}),then:(resolve:(value:unknown)=>void)=>Promise.resolve({data:rows.slice(from,to+1),error:null,count:exact?rows.length:null}).then(resolve)};return q;
}})}));
import {HandoffPanel} from '@/app/(app)/klinik/rawat-inap/[id]/HandoffPanel';
import Struk from '@/app/(app)/klinik/pembayaran/[visitId]/struk/page';
import Invoice from '@/app/(app)/klinik/pembayaran/[visitId]/invoice/page';
import GroupReceipt from '@/app/(app)/klinik/pembayaran/[visitId]/struk-rombongan/page';
const DOKUMEN=[['struk',Struk],['invoice',Invoice],['rombongan',GroupReceipt]] as const;
beforeEach(()=>{state.legacy=false;state.tanpaDokter=false;state.grooming=false});
const teks=(html:string)=>html.replace(/<[^>]+>/g,'');

// Grup klinik 3 Nov 2026 (Aldi/Andri, disetujui Reza): dokumen cetak menyebut petugas per
// jabatan — Dokter / Groomer / Staff — bukan satu baris "Dokter PJ" dan bukan nama per baris.
it.each(DOKUMEN)('%s prints the people involved grouped by job title',async(_name,Page)=>{
 const html=renderToStaticMarkup(await Page({params:Promise.resolve({visitId:'visit'})}));const t=teks(html);
 expect(t).toContain('Dokter: Dokter PJ Tersimpan, Dokter Saat Transaksi');
 expect(t).toContain('Staff: Perawat Saat Transaksi');
 expect(t).not.toContain('Groomer:');
 expect(html).toContain('Kasir Saat Transaksi');
 expect(html).not.toContain('Pelaksana');expect(t).not.toContain('Dokter PJ:');
});
it.each(DOKUMEN)('%s never prints a groomer PJ as the doctor on a grooming visit',async(_name,Page)=>{
 state.grooming=true;const t=teks(renderToStaticMarkup(await Page({params:Promise.resolve({visitId:'visit'})})));
 expect(t).toContain('Groomer: Agung Groomer');
 expect(t).toContain('Dokter: Dokter Saat Transaksi');
 expect(t).not.toContain('Dokter: Agung');expect(t).not.toContain('Dokter PJ');
});
it.each(DOKUMEN)('%s falls back to the doctor name stored on the visit for legacy documents',async(_name,Page)=>{
 state.legacy=true;const html=renderToStaticMarkup(await Page({params:Promise.resolve({visitId:'visit'})}));
 expect(teks(html)).toContain('Dokter: PIC Kasus');
 // Kasir yang tidak tercatat tidak boleh direkonstruksi dari dokter PJ.
 expect(html).toContain('Kasir belum tercatat');expect(html).not.toMatch(/Kasir<\/span><span>: PIC Kasus/);
 expect(html).not.toContain('data lama');
});
it.each(DOKUMEN)('%s omits the staff lines entirely when nobody is recorded',async(_name,Page)=>{
 state.legacy=true;state.tanpaDokter=true;const t=teks(renderToStaticMarkup(await Page({params:Promise.resolve({visitId:'visit'})})));
 for(const label of ['Dokter:','Groomer:','Staff:'])expect(t).not.toContain(label);
});

it('inpatient handoff shows source prescription snapshots separately from the case doctor',()=>{
 const html=renderToStaticMarkup(<HandoffPanel visitId="visit" admittedAt="2026-10-23T10:00:00Z" data={{doctor:'PIC Kasus',complaint:null,records:[],recipes:[],invoices:[],invoiceLines:[],evidence:[],prescriptions:[{id:'rx',medical_record_id:'record',nama_obat:'Jasa',qty:1,satuan:'jasa',jenis:'jasa',aturan_pakai:null,compound_recipe_id:null,created_at:'2026-10-23T10:00:00Z',service_performers:{version:1,doctor_id:'doctor',doctor_name:'Dokter Pelaksana Sumber',staff_id:null}}]}}/>);
 expect(html).toContain('Dokter Pelaksana Sumber');expect(html).toContain('PIC Kasus');
});
