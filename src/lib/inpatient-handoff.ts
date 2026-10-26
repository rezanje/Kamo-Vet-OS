import type { ServicePerformersSnapshot } from "./service-performers";
import type { createClient } from './supabase/server';
import { readCompleteList } from './checked-list';
type Db=Awaited<ReturnType<typeof createClient>>;
export type HandoffRecord={id:string;visit_id:string;created_at:string;anamnesis:string|null;diagnosis:string|null;catatan_resep:string|null};
export type HandoffPrescription={service_performers?:ServicePerformersSnapshot|null;id:string;medical_record_id:string;inpatient_record_id?:string|null;kategori?:string|null;nama_obat:string;qty:number;satuan:string|null;jenis:string;aturan_pakai:string|null;compound_recipe_id:string|null;created_at:string};
export type HandoffRecipe={id:string;medical_record_id:string;recipe_name:string;total_volume:string;dosage_form:string;dosage_instruction:string;status:string;created_at:string};
export type HandoffInvoice={id:string;invoice_no:string|null;paid_status:string;voided_at:string|null;created_at:string};
export type HandoffInvoiceLine={id:string;invoice_id:string;prescription_item_id:string|null;compound_recipe_id:string|null;qty:number};
export type HandoffEvidence={id:string;prescription_item_id:string;kind:'handover'|'administration';qty:number|string;unit:string|null;occurred_at:string;recorded_by_name:string|null;note:string|null;voided_at:string|null;voided_by_name:string|null;void_reason:string|null};
/** evidence: [] = none recorded, null = could not be read completely (never shown as "none"). */
export type InpatientHandoff={doctor:string|null;complaint:string|null;records:HandoffRecord[];prescriptions:HandoffPrescription[];recipes:HandoffRecipe[];invoices:HandoffInvoice[];invoiceLines:HandoffInvoiceLine[];evidence:HandoffEvidence[]|null};

export type HandoffSourceRow={key:string;name:string;kind:string;prescribed:string;billing:string;payment:string;handover:string;administration:string;duplicateActiveInvoices:boolean};
export type HandoffSourceStatus={rows:HandoffSourceRow[];gaps:string[]};
export type PaidInpatientStay={kind:'paid'|'unallocated'|'unbilled'|'unverified';days:number|null;invoiceNo:string|null};

/** Count paid days only when one stored stay source matches one active, fully paid invoice line. */
export function paidInpatientStay(data:InpatientHandoff,recordId:string):PaidInpatientStay{
 const unknown:PaidInpatientStay={kind:'unverified',days:null,invoiceNo:null};
 const sources=data.prescriptions.filter(row=>row.inpatient_record_id===recordId);
 if(sources.length!==1){
  return sources.length>1||data.prescriptions.some(row=>row.kategori==='Rawat Inap'&&!row.inpatient_record_id)
   ?unknown:{kind:'unbilled',days:null,invoiceNo:null};
 }
 const source=sources[0];
 if(source.jenis!=='jasa'||source.kategori!=='Rawat Inap'||!Number.isInteger(source.qty)||source.qty<=0)return unknown;
 const linked=data.invoiceLines.filter(line=>line.prescription_item_id===source.id);
 const invoices=new Map(data.invoices.map(invoice=>[invoice.id,invoice]));
 if(linked.some(line=>!invoices.has(line.invoice_id)))return unknown;
 const active=linked.filter(line=>!invoices.get(line.invoice_id)?.voided_at);
 if(!active.length)return {kind:'unbilled',days:null,invoiceNo:null};
 if(active.length!==1||Number(active[0].qty)!==Number(source.qty))return unknown;
 const invoice=invoices.get(active[0].invoice_id)!;
 if(invoice.paid_status==='Lunas')return {kind:'paid',days:source.qty,invoiceNo:invoice.invoice_no};
 if(invoice.paid_status==='DP'||invoice.paid_status==='Belum Lunas')return {kind:'unallocated',days:null,invoiceNo:invoice.invoice_no};
 return unknown;
}
const paymentStatus:Record<string,string>={
 'Lunas':'Faktur lunas; pembayaran belum dialokasikan per baris',
 'DP':'Faktur DP: pembayaran belum dialokasikan per baris',
 'Belum Lunas':'Faktur belum lunas',
};
const pharmacyStatus:Record<string,string>={pending:'Menunggu diracik',ready:'Siap diserahkan',handed_over:'Diserahkan oleh farmasi',void:'Racikan dibatalkan'};

/** Regular drug = the only kind that has per-prescription handover/administration evidence. */
export const isRegularDrug=(p:Pick<HandoffPrescription,'jenis'|'compound_recipe_id'>)=>p.jenis==='obat'&&!p.compound_recipe_id;
const qtyText=(value:number)=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:3}).format(value);
/** Active (non-voided) totals per kind, matched by exact prescription_item_id only. */
export function evidenceTotals(evidence:readonly HandoffEvidence[],prescriptionId:string){
 const rows=evidence.filter(row=>row.prescription_item_id===prescriptionId);
 const sum=(kind:HandoffEvidence['kind'])=>Math.round(rows.filter(row=>row.kind===kind&&!row.voided_at).reduce((total,row)=>total+Number(row.qty),0)*1000)/1000;
 return {handedOver:sum('handover'),administered:sum('administration'),voided:rows.filter(row=>row.voided_at).length};
}

/** Read-only source status. Invoice payment belongs to the whole invoice, never to one line. */
export function handoffSourceStatus(data:InpatientHandoff,recordId?:string):HandoffSourceStatus{
 const invoiceById=new Map(data.invoices.map(invoice=>[invoice.id,invoice]));
 const recipeById=new Map(data.recipes.map(recipe=>[recipe.id,recipe]));
 const linkedRecipes=new Set(data.prescriptions.map(row=>row.compound_recipe_id).filter((id):id is string=>Boolean(id)));
 const evidence=data.evidence;
 const sourceRow=(key:string,name:string,kind:string,prescribed:string,prescriptionId:string|null,recipeId:string|null,rx?:HandoffPrescription):HandoffSourceRow=>{
  const linkedLines=data.invoiceLines.filter(line=>(prescriptionId!==null&&line.prescription_item_id===prescriptionId)||(recipeId!==null&&line.compound_recipe_id===recipeId));
  const active=linkedLines.flatMap(line=>{const invoice=invoiceById.get(line.invoice_id);return invoice&&!invoice.voided_at?[{line,invoice}]:[];});
  const billing=active.length
   ?`Ditagih: ${active.map(({line,invoice})=>`${invoice.invoice_no??'Nomor faktur tidak tersedia'} · qty faktur ${line.qty}`).join('; ')}`
   :!linkedLines.length?'Belum ada tautan tagihan per baris'
   :linkedLines.some(line=>!invoiceById.has(line.invoice_id))?'Faktur tautan tidak tersedia':'Hanya pada faktur dibatalkan';
  const payment=active.length?[...new Set(active.map(({invoice})=>paymentStatus[invoice.paid_status]??`Status faktur tidak dikenali: ${invoice.paid_status||'kosong'}`))].join(' · '):'Tidak dapat dinilai tanpa faktur aktif';
  const recipe=recipeId?recipeById.get(recipeId):undefined;
  let handover=recipeId?(recipe?pharmacyStatus[recipe.status]??'Status racikan tidak dikenali':'Racikan tidak tersedia pada ringkasan'):kind==='jasa'?'Tidak berlaku untuk jasa':'Belum ada bukti penyerahan per baris';
  let administration=kind==='jasa'?'Belum ada bukti pelaksanaan per baris':'Belum ada bukti pemberian per resep';
  if(rx&&isRegularDrug(rx)){
   if(evidence===null){handover='Bukti penyerahan belum dapat dimuat';administration='Bukti pemberian belum dapat dimuat';}
   else{
    const totals=evidenceTotals(evidence,rx.id),unit=rx.satuan??'',voided=totals.voided?` · ${totals.voided} catatan dibatalkan`:'';
    if(totals.handedOver>0)handover=`Diserahkan ${qtyText(totals.handedOver)} dari ${rx.qty} ${unit}`.trim();
    if(totals.administered>0)administration=`Diberikan ${qtyText(totals.administered)} dari ${rx.qty} ${unit}`.trim();
    if(voided){handover+=voided;administration+=voided;}
   }
  }
  return {key,name,kind,prescribed,billing,payment,handover,administration,duplicateActiveInvoices:new Set(active.map(({invoice})=>invoice.id)).size>1};
 };
 const rows=[
  ...data.prescriptions.map(p=>sourceRow(`rx:${p.id}`,p.nama_obat,p.jenis,`${p.qty} ${p.satuan??''}`.trim(),p.id,p.compound_recipe_id,p)),
  ...data.recipes.map(recipe=>sourceRow(`recipe:${recipe.id}`,recipe.recipe_name,'racikan',`${recipe.total_volume} · ${recipe.dosage_form}`,null,recipe.id)),
 ];
 const unlinked=rows.filter(row=>row.billing==='Belum ada tautan tagihan per baris'&&(!row.key.startsWith('recipe:')||!linkedRecipes.has(row.key.slice(7)))).length;
 const freeLines=data.invoiceLines.filter(line=>!line.prescription_item_id&&!line.compound_recipe_id).length;
 return {rows,gaps:[
  'Bukti penyerahan dan pemberian per resep hanya berlaku untuk obat biasa. Racikan memakai status farmasi; pelaksanaan jasa belum punya bukti per baris; dosis berprotokol ada di Obat Khusus dan tidak digabung.',
  'Bukti penyerahan dan pemberian tidak mengubah stok, jurnal, atau tagihan.',
  ...(evidence===null?['Bukti penyerahan/pemberian obat biasa belum dapat dimuat lengkap; jangan menyimpulkan obat belum diserahkan atau diberikan.']:[]),
  'Status bayar tersimpan per faktur, bukan per baris; faktur DP tidak dialokasikan ke obat/tindakan tertentu.',
  ...(!recordId||paidInpatientStay(data,recordId).kind!=='paid'?['Lama inap terbayar belum dapat dipastikan dari relasi sumber dan faktur lunas yang tersimpan.']:[]),
  ...(unlinked?[`${unlinked} baris resep/racikan belum punya tautan tagihan per baris dan tidak dipasangkan berdasarkan nama.`]:[]),
  ...(freeLines?[`${freeLines} baris faktur tanpa ID resep/racikan tidak dipasangkan ke baris mana pun.`]:[]),
 ]};
}

/** Same session/RLS, explicit visit/branch and source IDs only. No writes or inference by name. */
export async function loadInpatientHandoff(db:Db,visitId:string,branchId:string):Promise<InpatientHandoff|null>{
 try{
  const visit=await db.from('visits').select('id,dokter,keluhan').eq('id',visitId).eq('branch_id',branchId).maybeSingle();
  if(visit.error||!visit.data)return null;
  const [records,invoices]=await Promise.all([
   readCompleteList<HandoffRecord>((from,to)=>db.from('medical_records').select('id,visit_id,created_at,anamnesis,diagnosis,catatan_resep',{count:'exact'}).eq('visit_id',visitId).order('created_at').order('id').range(from,to),'Rekam medis handoff',{maxRows:null}),
   readCompleteList<HandoffInvoice>((from,to)=>db.from('invoices').select('id,invoice_no,paid_status,voided_at,created_at',{count:'exact'}).eq('visit_id',visitId).order('created_at').order('id').range(from,to),'Faktur handoff',{maxRows:null}),
  ]);
  const prescriptions:HandoffPrescription[]=[],recipes:HandoffRecipe[]=[],invoiceLines:HandoffInvoiceLine[]=[];
  // Bounded IN lists, with complete checked pagination within each scope.
  for(let offset=0;offset<records.length;offset+=200){
   const ids=records.slice(offset,offset+200).map(row=>row.id);
   const [rx,compounds]=await Promise.all([
    readCompleteList<HandoffPrescription>((from,to)=>db.from('prescription_items').select('id,medical_record_id,inpatient_record_id,kategori,nama_obat,qty,satuan,jenis,aturan_pakai,compound_recipe_id,created_at,service_performers',{count:'exact'}).in('medical_record_id',ids).order('created_at').order('id').range(from,to),'Resep handoff',{maxRows:null}),
    readCompleteList<HandoffRecipe>((from,to)=>db.from('compounding_recipes').select('id,medical_record_id,recipe_name,total_volume,dosage_form,dosage_instruction,status,created_at',{count:'exact'}).in('medical_record_id',ids).order('created_at').order('id').range(from,to),'Racikan handoff',{maxRows:null}),
   ]);prescriptions.push(...rx);recipes.push(...compounds);
  }
  for(let offset=0;offset<invoices.length;offset+=200){
   const ids=invoices.slice(offset,offset+200).map(row=>row.id);
   invoiceLines.push(...await readCompleteList<HandoffInvoiceLine>((from,to)=>db.from('invoice_items').select('id,invoice_id,prescription_item_id,compound_recipe_id,qty',{count:'exact'}).in('invoice_id',ids).order('id').range(from,to),'Tautan tagihan handoff',{maxRows:null}));
  }
  // Evidence is read separately: a missing table or partial read disables recording, not the whole summary.
  let evidence:HandoffEvidence[]|null=[];
  try{
   const regularIds=prescriptions.filter(isRegularDrug).map(row=>row.id);
   for(let offset=0;offset<regularIds.length;offset+=200){
    const ids=regularIds.slice(offset,offset+200);
    evidence.push(...await readCompleteList<HandoffEvidence>((from,to)=>db.from('inpatient_rx_evidence').select('id,prescription_item_id,kind,qty,unit,occurred_at,recorded_by_name,note,voided_at,voided_by_name,void_reason',{count:'exact'}).in('prescription_item_id',ids).order('occurred_at').order('id').range(from,to),'Bukti obat biasa',{maxRows:null}));
   }
  }catch{evidence=null;}
  return {doctor:visit.data.dokter,complaint:visit.data.keluhan,records,prescriptions,recipes,invoices,invoiceLines,evidence};
 }catch{return null;}
}
