import type { createClient } from './supabase/server';
import { readCompleteList } from './checked-list';
type Db=Awaited<ReturnType<typeof createClient>>;
export type HandoffRecord={id:string;visit_id:string;created_at:string;anamnesis:string|null;diagnosis:string|null;catatan_resep:string|null};
export type HandoffPrescription={id:string;medical_record_id:string;nama_obat:string;qty:number;satuan:string|null;jenis:string;aturan_pakai:string|null;compound_recipe_id:string|null;created_at:string};
export type HandoffRecipe={id:string;medical_record_id:string;recipe_name:string;total_volume:string;dosage_form:string;dosage_instruction:string;status:string;created_at:string};
export type HandoffInvoice={id:string;invoice_no:string|null;paid_status:string;voided_at:string|null;created_at:string};
export type HandoffInvoiceLine={id:string;invoice_id:string;prescription_item_id:string|null;compound_recipe_id:string|null;qty:number};
export type InpatientHandoff={doctor:string|null;records:HandoffRecord[];prescriptions:HandoffPrescription[];recipes:HandoffRecipe[];invoices:HandoffInvoice[];invoiceLines:HandoffInvoiceLine[]};

/** Same session/RLS, explicit visit/branch and source IDs only. No writes or inference by name. */
export async function loadInpatientHandoff(db:Db,visitId:string,branchId:string):Promise<InpatientHandoff|null>{
 try{
  const visit=await db.from('visits').select('id,dokter').eq('id',visitId).eq('branch_id',branchId).maybeSingle();
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
    readCompleteList<HandoffPrescription>((from,to)=>db.from('prescription_items').select('id,medical_record_id,nama_obat,qty,satuan,jenis,aturan_pakai,compound_recipe_id,created_at',{count:'exact'}).in('medical_record_id',ids).order('created_at').order('id').range(from,to),'Resep handoff',{maxRows:null}),
    readCompleteList<HandoffRecipe>((from,to)=>db.from('compounding_recipes').select('id,medical_record_id,recipe_name,total_volume,dosage_form,dosage_instruction,status,created_at',{count:'exact'}).in('medical_record_id',ids).order('created_at').order('id').range(from,to),'Racikan handoff',{maxRows:null}),
   ]);prescriptions.push(...rx);recipes.push(...compounds);
  }
  for(let offset=0;offset<invoices.length;offset+=200){
   const ids=invoices.slice(offset,offset+200).map(row=>row.id);
   invoiceLines.push(...await readCompleteList<HandoffInvoiceLine>((from,to)=>db.from('invoice_items').select('id,invoice_id,prescription_item_id,compound_recipe_id,qty',{count:'exact'}).in('invoice_id',ids).order('id').range(from,to),'Tautan tagihan handoff',{maxRows:null}));
  }
  return {doctor:visit.data.dokter,records,prescriptions,recipes,invoices,invoiceLines};
 }catch{return null;}
}
