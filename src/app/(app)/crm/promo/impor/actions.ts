"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readCompleteList } from "@/lib/checked-list";
import { readPromoExcel, type PromoExcelRow } from "@/lib/promo-excel";
import { validatePromoRows, type PromoCatalogItem, type PromoCatalogUnit, type PromoReviewedRow } from "@/lib/promo-bulk";

type Review = { rows: PromoReviewedRow[]; valid: boolean; error?: string };
export type PromoImportSubmission = {
  key: string; name: string; validFrom: string; validUntil: string;
  allBranches: boolean; branchIds: string[]; rows: PromoExcelRow[];
};

async function managerClient() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Sesi berakhir. Masuk kembali sebelum mengimpor promo.");
  const { data: profile, error } = await db.from("profiles").select("role,is_active").eq("id",user.id).maybeSingle();
  if (error || !profile?.is_active || !["OWNER","ADMIN"].includes(profile.role)) {
    throw new Error("Hanya Owner/Admin aktif yang boleh mengimpor promo.");
  }
  return db;
}

async function review(db: Awaited<ReturnType<typeof managerClient>>, rows: PromoExcelRow[]): Promise<Review> {
  if (!Array.isArray(rows) || rows.length<1 || rows.length>500) throw new Error("Impor promo harus berisi 1 sampai 500 baris.");
  const codes=[...new Set(rows.map(row=>String(row.code??"").trim()).filter(Boolean))];
  const items: PromoCatalogItem[]=[];
  for(let offset=0;offset<codes.length;offset+=150) {
    items.push(...await readCompleteList<PromoCatalogItem>((from,to)=>db.from("items")
      .select("id,code,name,unit,is_active",{count:"exact"}).in("code",codes.slice(offset,offset+150)).order("id").range(from,to),
    "Master SKU promo",{maxRows:null}));
  }
  const ids=items.map(item=>item.id);
  const units: (PromoCatalogUnit & {id:string})[]=[];
  for(let offset=0;offset<ids.length;offset+=150) {
    units.push(...await readCompleteList<PromoCatalogUnit & {id:string}>((from,to)=>db.from("item_units")
      .select("id,item_id,unit",{count:"exact"}).in("item_id",ids.slice(offset,offset+150)).order("id").range(from,to),
    "Satuan SKU promo",{maxRows:null}));
  }
  const result=validatePromoRows(rows,items,units);
  return {rows:result.reviewed,valid:result.reviewed.every(row=>!row.error)};
}

export async function previewPromoExcel(formData: FormData): Promise<Review> {
  try {
    const db=await managerClient();
    const file=formData.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Pilih file Excel .xlsx dari format promo.");
    const rows=await readPromoExcel(new Uint8Array(await file.arrayBuffer()));
    return await review(db,rows);
  } catch(error) {return {rows:[],valid:false,error:error instanceof Error?error.message:"File promo tidak dapat dibaca"};}
}

export async function validatePromoDraft(rows: PromoExcelRow[]): Promise<Review> {
  try {return await review(await managerClient(),rows);}
  catch(error) {return {rows:Array.isArray(rows)?rows.map(row=>({...row,item_name:null,error:null})):[],valid:false,error:error instanceof Error?error.message:"Baris promo tidak dapat diperiksa"};}
}

export async function savePromoExcelBatch(input: PromoImportSubmission): Promise<{ok:boolean;message:string;repeat?:boolean}> {
  try {
    const db=await managerClient();
    const result=await review(db,input.rows);
    if(!result.valid)return {ok:false,message:"Periksa baris yang ditandai, lalu validasi ulang sebelum menyimpan."};
    const name=String(input.name??"").trim();
    const dates=[input.validFrom,input.validUntil];
    if(!name || name.length>40 || dates.some(value=>!/^\d{4}-\d{2}-\d{2}$/.test(value)) || input.validUntil<input.validFrom)
      return {ok:false,message:"Nama batch (maks. 40 karakter) dan tanggal mulai/akhir yang berurutan wajib diisi."};
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.key))return {ok:false,message:"Identitas batch tidak valid. Muat ulang halaman."};
    const branches=[...new Set(input.branchIds??[])];
    if((input.allBranches&&branches.length>0)||(!input.allBranches&&branches.length===0))
      return {ok:false,message:"Pilih semua cabang atau sedikitnya satu cabang tertentu."};
    // Use the exact normalized values just reviewed; never trust client-side
    // status. PostgreSQL revalidates every SKU, unit, branch and discount again.
    const normalized=result.rows.map(row=>({code:row.code,unit:row.unit,discount_type:row.discount_type,discount_value:Number(row.discount_value)}));
    const {data,error}=await db.rpc("import_promo_excel_batch",{
      p_key:input.key,
      p_batch:{name,valid_from:input.validFrom,valid_until:input.validUntil,all_branches:input.allBranches,branch_ids:branches},
      p_rows:normalized,
    });
    if(error)return {ok:false,message:error.message};
    revalidatePath("/crm/promo");
    return {ok:true,message:`${Number(data?.imported??0)} promo ${data?.repeat?"sudah ada, tidak digandakan":"berhasil disimpan"}.`,repeat:!!data?.repeat};
  } catch(error) {return {ok:false,message:error instanceof Error?error.message:"Batch promo gagal disimpan"};}
}
