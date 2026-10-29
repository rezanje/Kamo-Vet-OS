import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({legacy:false,tanpaDokter:false}));
vi.mock('next/link',()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('not found')}}));
vi.mock('@/lib/rombongan-server',()=>({bacaRombongan:async()=>({tanggal:'2026-10-23',customerName:'Pemilik',baris:[{visitId:'visit',invoiceNo:'INV-1',hewan:'Milo',paidStatus:'Lunas',total:100,sisa:0}]})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({from(table:string){
 const invoice={id:'invoice',invoice_no:'INV-1',subtotal:100,discount:0,tax:0,total:100,dp_amount:0,paid_status:'Lunas',metode_bayar:'Tunai',created_at:'2026-10-23T10:00:00Z',cashier_name:state.legacy?null:'Kasir Saat Transaksi'};
 const visit={id:'visit',poli:'Klinik',doctor_id:state.legacy||state.tanpaDokter?null:'dokter-pj',dokter:state.tanpaDokter?null:'PIC Kasus',pets:{name:'Milo',species:'Kucing'},customers:{name:'Pemilik'},branches:{name:'Cabang'}};
 const rows=table==='invoice_items'?[{invoice_id:'invoice',deskripsi:'Jasa tersimpan',jenis:'jasa',qty:1,harga:100,service_performers:state.legacy?null:{version:1,doctor_id:'doctor',doctor_name:'Dokter Saat Transaksi',staff_id:'staff',staff_name:'Perawat Saat Transaksi'}}]
  :table==='invoices'?[invoice]:table==='visits'?[visit]:table==='employees'?[{id:'dokter-pj',nama:'Dokter PJ Tersimpan'}]:[];
 const result={data:rows,error:null};
 const q={select:()=>q,eq:()=>q,is:()=>q,in:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:table==='visits'?visit:table==='invoices'?invoice:null,error:null}),then:(resolve:(value:unknown)=>void)=>Promise.resolve(result).then(resolve)};return q;
}})}));
import {HandoffPanel} from '@/app/(app)/klinik/rawat-inap/[id]/HandoffPanel';
import Struk from '@/app/(app)/klinik/pembayaran/[visitId]/struk/page';
import Invoice from '@/app/(app)/klinik/pembayaran/[visitId]/invoice/page';
import GroupReceipt from '@/app/(app)/klinik/pembayaran/[visitId]/struk-rombongan/page';
const DOKUMEN=[['struk',Struk],['invoice',Invoice],['rombongan',GroupReceipt]] as const;
beforeEach(()=>{state.legacy=false;state.tanpaDokter=false});

// Permintaan Andri 29 Okt 2026: dokumen cetak cukup menyebut dokter PJ kunjungan.
// Nama pelaksana per baris tidak lagi dicetak, tetapi tetap ada di layar kerja staf.
it.each(DOKUMEN)('%s prints the attending doctor and never a per-line performer name',async(_name,Page)=>{
 const html=renderToStaticMarkup(await Page({params:Promise.resolve({visitId:'visit'})}));
 expect(html).toContain('Dokter PJ');expect(html).toContain('Dokter PJ Tersimpan');
 expect(html).toContain('Kasir Saat Transaksi');
 expect(html).not.toContain('Dokter Saat Transaksi');expect(html).not.toContain('Perawat Saat Transaksi');
 expect(html).not.toContain('Pelaksana');
});
it.each(DOKUMEN)('%s falls back to the doctor name stored on the visit for legacy documents',async(_name,Page)=>{
 state.legacy=true;const html=renderToStaticMarkup(await Page({params:Promise.resolve({visitId:'visit'})}));
 expect(html).toContain('PIC Kasus');
 // Kasir yang tidak tercatat tidak boleh direkonstruksi dari dokter PJ.
 expect(html).toContain('Kasir belum tercatat');expect(html).not.toMatch(/Kasir<\/span><span>: PIC Kasus/);
 expect(html).not.toContain('data lama');
});
it.each(DOKUMEN)('%s omits the doctor line entirely when the visit has none',async(_name,Page)=>{
 state.tanpaDokter=true;const html=renderToStaticMarkup(await Page({params:Promise.resolve({visitId:'visit'})}));
 expect(html).not.toContain('Dokter PJ');
});

it('inpatient handoff shows source prescription snapshots separately from the case doctor',()=>{
 const html=renderToStaticMarkup(<HandoffPanel visitId="visit" admittedAt="2026-10-23T10:00:00Z" data={{doctor:'PIC Kasus',complaint:null,records:[],recipes:[],invoices:[],invoiceLines:[],evidence:[],prescriptions:[{id:'rx',medical_record_id:'record',nama_obat:'Jasa',qty:1,satuan:'jasa',jenis:'jasa',aturan_pakai:null,compound_recipe_id:null,created_at:'2026-10-23T10:00:00Z',service_performers:{version:1,doctor_id:'doctor',doctor_name:'Dokter Pelaksana Sumber',staff_id:null}}]}}/>);
 expect(html).toContain('Dokter Pelaksana Sumber');expect(html).toContain('PIC Kasus');
});
