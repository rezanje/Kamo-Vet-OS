"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readCompleteList } from "@/lib/checked-list";
import { readPromoExcel, type PromoExcelRow } from "@/lib/promo-excel";
import { validatePromoRows, type PromoCatalogItem, type PromoCatalogUnit, type PromoPricing, type PromoReviewedRow, type PromoSaveRow } from "@/lib/promo-bulk";
import type { FinalPriceBranch, FinalPriceBranchPrice } from "@/lib/promo-final-price";
import { hariIniWIB } from "@/lib/tanggal";

type Review = { rows: PromoReviewedRow[]; valid: boolean; error?: string };
/** Rows sent back by the client may carry the normal price shown in the preview (Harga Akhir rows). */
export type PromoImportRow = PromoExcelRow & { normal_price?: number | null };
export type PromoBranchScope = { allBranches: boolean; branchIds: string[] };
export type PromoImportSubmission = {
  key: string; name: string; validFrom: string; validUntil: string;
  allBranches: boolean; branchIds: string[]; rows: PromoImportRow[];
};
const isFinalPriceKind = (value: unknown) => ["harga akhir", "harga akhir promo", "final_price"].includes(String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase());
const CHUNK = 150;
// item_branch_prices / item_price_tiers go through the URL as in(...) lists of uuids: keep both lists short.
const PRICE_CHUNK = 50;

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

type Db = Awaited<ReturnType<typeof managerClient>>;

/** Branches the batch applies to; null when the selection is not (validly) made yet. */
async function readScope(db: Db, scope: PromoBranchScope | undefined): Promise<FinalPriceBranch[] | null> {
  if (!scope) return null;
  const ids = [...new Set(scope.branchIds ?? [])];
  if (scope.allBranches) {
    if (ids.length > 0) return null;
    const branches = await readCompleteList<FinalPriceBranch>((from, to) => db.from("branches")
      .select("id,name", { count: "exact" }).eq("is_active", true).order("id").range(from, to), "Cabang promo", { maxRows: null });
    return branches.length ? branches : null;
  }
  if (ids.length === 0) return null;
  const found: (FinalPriceBranch & { is_active: boolean })[] = [];
  for (let offset = 0; offset < ids.length; offset += CHUNK) {
    found.push(...await readCompleteList<FinalPriceBranch & { is_active: boolean }>((from, to) => db.from("branches")
      .select("id,name,is_active", { count: "exact" }).in("id", ids.slice(offset, offset + CHUNK)).order("id").range(from, to), "Cabang promo", { maxRows: null }));
  }
  if (found.length !== ids.length || found.some(branch => !branch.is_active)) throw new Error("Cabang yang dipilih tidak ditemukan atau nonaktif. Muat ulang halaman.");
  return ids.map(id => ({ id, name: found.find(branch => branch.id === id)!.name }));
}

async function review(db: Db, rows: PromoImportRow[], scope?: PromoBranchScope): Promise<Review & { saveRows: PromoSaveRow[] }> {
  if (!Array.isArray(rows) || rows.length<1 || rows.length>500) throw new Error("Impor promo harus berisi 1 sampai 500 baris.");
  const codes=[...new Set(rows.map(row=>String(row.code??"").trim()).filter(Boolean))];
  const items: PromoCatalogItem[]=[];
  for(let offset=0;offset<codes.length;offset+=CHUNK) {
    items.push(...await readCompleteList<PromoCatalogItem>((from,to)=>db.from("items")
      .select("id,code,name,unit,is_active,item_type,sell_price,buy_price",{count:"exact"}).in("code",codes.slice(offset,offset+CHUNK)).order("id").range(from,to),
    "Master SKU promo",{maxRows:null}));
  }
  const ids=items.map(item=>item.id);
  const units: (PromoCatalogUnit & {id:string})[]=[];
  for(let offset=0;offset<ids.length;offset+=CHUNK) {
    units.push(...await readCompleteList<PromoCatalogUnit & {id:string}>((from,to)=>db.from("item_units")
      .select("id,item_id,unit,sell_price,buy_price",{count:"exact"}).in("item_id",ids.slice(offset,offset+CHUNK)).order("id").range(from,to),
    "Satuan SKU promo",{maxRows:null}));
  }
  // Price context is only read when a Harga Akhir row exists; Persen/Nominal files behave exactly as before.
  let pricing: PromoPricing | undefined;
  if (rows.some(row=>isFinalPriceKind(row.discount_type))) {
    const finalCodes=new Set(rows.filter(row=>isFinalPriceKind(row.discount_type)).map(row=>String(row.code??"").trim()));
    const finalIds=items.filter(item=>finalCodes.has(item.code)).map(item=>item.id);
    const branches=await readScope(db,scope);
    const branchPrices: (FinalPriceBranchPrice & {id:string})[]=[];
    const tierIds=new Set<string>();
    for(let offset=0;offset<finalIds.length;offset+=PRICE_CHUNK) {
      const chunk=finalIds.slice(offset,offset+PRICE_CHUNK);
      // Disjoint item chunk x branch chunk partitions: every row is read exactly once, each read keeps exact-count semantics.
      if(branches) for(let at=0;at<branches.length;at+=PRICE_CHUNK) {
        const branchChunk=branches.slice(at,at+PRICE_CHUNK).map(branch=>branch.id);
        branchPrices.push(...await readCompleteList<FinalPriceBranchPrice & {id:string}>((from,to)=>db.from("item_branch_prices")
          .select("id,item_id,branch_id,unit,sell_price",{count:"exact"}).in("item_id",chunk).in("branch_id",branchChunk).order("id").range(from,to),
        "Harga cabang promo",{maxRows:null}));
      }
      const tiers=await readCompleteList<{id:string;item_id:string}>((from,to)=>db.from("item_price_tiers")
        .select("id,item_id",{count:"exact"}).in("item_id",chunk).order("id").range(from,to),"Harga bertingkat promo",{maxRows:null});
      for(const tier of tiers)tierIds.add(tier.item_id);
    }
    pricing={scope:branches,branchPrices,tierItemIds:[...tierIds]};
  }
  const result=validatePromoRows(rows,items,units,pricing);
  return {rows:result.reviewed,valid:result.reviewed.every(row=>!row.error),saveRows:result.valid};
}

export async function previewPromoExcel(formData: FormData): Promise<Review> {
  try {
    const db=await managerClient();
    const file=formData.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Pilih file Excel .xlsx dari format promo.");
    const rows=await readPromoExcel(new Uint8Array(await file.arrayBuffer()));
    const scope: PromoBranchScope={allBranches:["1","true"].includes(String(formData.get("allBranches")??"")),branchIds:formData.getAll("branchId").map(String)};
    const {rows:reviewed,valid}=await review(db,rows,scope);
    return {rows:reviewed,valid};
  } catch(error) {return {rows:[],valid:false,error:error instanceof Error?error.message:"File promo tidak dapat dibaca"};}
}

export async function validatePromoDraft(rows: PromoImportRow[], scope?: PromoBranchScope): Promise<Review> {
  try {const {rows:reviewed,valid}=await review(await managerClient(),rows,scope);return {rows:reviewed,valid};}
  catch(error) {return {rows:Array.isArray(rows)?rows.map(row=>({...row,item_name:null,error:null})):[],valid:false,error:error instanceof Error?error.message:"Baris promo tidak dapat diperiksa"};}
}

export async function savePromoExcelBatch(input: PromoImportSubmission): Promise<{ok:boolean;message:string;repeat?:boolean}> {
  try {
    const db=await managerClient();
    const result=await review(db,input.rows,{allBranches:!!input.allBranches,branchIds:input.branchIds??[]});
    // Bind a Harga Akhir save to the normal price the user reviewed: a price edit in between must be re-reviewed.
    const finalIndexes=result.rows.flatMap((row,index)=>row.discount_type==="final_price"?[index]:[]);
    for(const index of finalIndexes){
      const shown=input.rows[index]?.normal_price;
      const fresh=result.rows[index].normal_price;
      if(typeof shown==="number"&&typeof fresh==="number"&&Math.round(shown*100)!==Math.round(fresh*100))
        return {ok:false,message:"Harga normal berubah, validasi ulang"};
    }
    if(!result.valid)return {ok:false,message:"Periksa baris yang ditandai, lalu validasi ulang sebelum menyimpan."};
    const name=String(input.name??"").trim();
    const dates=[input.validFrom,input.validUntil];
    if(!name || name.length>40 || dates.some(value=>!/^\d{4}-\d{2}-\d{2}$/.test(value)) || input.validUntil<input.validFrom)
      return {ok:false,message:"Nama batch (maks. 40 karakter) dan tanggal mulai/akhir yang berurutan wajib diisi."};
    // Batch yang tanggal akhirnya sudah lewat akan ditolak database (trigger
    // promo_kadaluarsa_otomatis); dijawab di sini supaya pesannya jelas.
    if(input.validUntil<hariIniWIB())
      return {ok:false,message:"Tanggal akhir batch sudah lewat. Isi tanggal hari ini atau sesudahnya."};
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.key))return {ok:false,message:"Identitas batch tidak valid. Muat ulang halaman."};
    const branches=[...new Set(input.branchIds??[])];
    if((input.allBranches&&branches.length>0)||(!input.allBranches&&branches.length===0))
      return {ok:false,message:"Pilih semua cabang atau sedikitnya satu cabang tertentu."};
    // Use the exact normalized values just reviewed; never trust client-side
    // status. PostgreSQL revalidates every SKU, unit, branch and discount again.
    for(const index of finalIndexes){
      const shown=input.rows[index]?.normal_price;
      if(typeof shown!=="number")return {ok:false,message:"Harga normal belum divalidasi untuk baris Harga Akhir, validasi ulang"};
      if(Math.round(shown*100)!==Math.round(Number(result.rows[index].normal_price)*100))return {ok:false,message:"Harga normal berubah, validasi ulang"};
    }
    // Harga Akhir rows are already converted to a per-unit nominal discount; the RPC is unchanged.
    const normalized=result.saveRows;
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
