import {expect,it} from 'vitest';
import {barisTagihanVisit} from '../tagihan-klinik';
it('group billing copies saved performer snapshots without assigning the case doctor or cashier',async()=>{
 const saved={version:1,doctor_id:'doctor',doctor_name:'Dokter Saat Transaksi',staff_id:null,staff_name:null};
 const data={medical_records:{id:'record'},prescription_items:[{id:'a',nama_obat:'Jasa',qty:1,harga:100,jenis:'jasa',service_performers:saved},{id:'b',nama_obat:'Jasa lama',qty:1,harga:100,jenis:'jasa',service_performers:null},{id:'c',nama_obat:'Obat',qty:1,harga:100,jenis:'obat',service_performers:saved}]};
 const client={from(table:string){const result={data:data[table as keyof typeof data]};const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>result,then:(resolve:(value:unknown)=>void)=>Promise.resolve(result).then(resolve)};return q}};
 const rows=await barisTagihanVisit(client,'visit','Poli Umum');
 expect(rows.map(row=>row.service_performers)).toEqual([saved,undefined,undefined]);
});

it('retains the baseline empty-consultation payload shape for group retry compatibility',async()=>{
 const client={from(){const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:null})};return q}};
 expect(await barisTagihanVisit(client,'visit','Poli Umum')).toEqual([{deskripsi:'Jasa Konsultasi Poli Umum',qty:1,harga:0,jenis:'jasa',item_id:null,satuan:null,prescription_item_id:'',recipe_id:null}]);
});
