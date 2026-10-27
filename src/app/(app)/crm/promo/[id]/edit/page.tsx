import Link from 'next/link';
import {createClient} from '@/lib/supabase/server';
import {readCompleteList} from '@/lib/checked-list';
import {promoCategoryOptions,promoCategoryItem,type PromoCategoryItem} from '@/lib/promo-categories';
import type {KategoriRow} from '@/lib/kategori';
import type {MultiSelectItem} from '@/components/SearchableMultiSelect';
import {packageTotalReleased,type PromoEditSnapshot} from '@/lib/promo-edit';
import {ActivityHistoryLink} from '@/components/ActivityHistoryLink';
import {PromoEditor} from '../../PromoEditor';
const back=<Link className="back-btn" href="/crm/promo">Kembali ke daftar promo</Link>;
async function loadOptions(db:Awaited<ReturnType<typeof createClient>>,snapshot:PromoEditSnapshot){
  const [activeItems,branches,categoryRows]=await Promise.all([
   readCompleteList<PromoCategoryItem>((from,to)=>db.from('items').select('id,code,name,category_id',{count:'exact'}).eq('is_active',true).order('name').order('id').range(from,to),'Daftar barang promo',{maxRows:null}),
   readCompleteList<MultiSelectItem>((from,to)=>db.from('branches').select('id,code,name',{count:'exact'}).eq('is_active',true).order('name').order('id').range(from,to),'Daftar cabang promo',{maxRows:null}),
   readCompleteList<KategoriRow>((from,to)=>db.from('item_categories').select('id,name,parent_id,is_active',{count:'exact'}).order('name').order('id').range(from,to),'Daftar kategori promo',{maxRows:null}),
  ]);
  const categories=promoCategoryOptions(categoryRows),items:MultiSelectItem[]=activeItems.map(item=>promoCategoryItem(item,categories));
  const missing=snapshot.item_ids.filter(id=>!items.some(item=>item.id===id));
  for(let offset=0;offset<missing.length;offset+=200){
   const ids=missing.slice(offset,offset+200);
   const legacy=await readCompleteList<PromoCategoryItem>((from,to)=>db.from('items').select('id,code,name,category_id',{count:'exact'}).in('id',ids).order('id').range(from,to),'Informasi target lama',{maxRows:null});
   for(const id of ids){const item=legacy.find(row=>row.id===id);items.push(item?{...promoCategoryItem(item,categories),name:`${item.name} (target lama/nonaktif)`,selectable:false}:{id,code:'—',name:'Barang target lama tidak tersedia',selectable:false});}
  }
  const missingBranches=(snapshot.promo.branch_ids??[]).filter(id=>!branches.some(branch=>branch.id===id));
  for(let offset=0;offset<missingBranches.length;offset+=200){
   const ids=missingBranches.slice(offset,offset+200);
   const legacy=await readCompleteList<MultiSelectItem>((from,to)=>db.from('branches').select('id,code,name',{count:'exact'}).in('id',ids).order('id').range(from,to),'Informasi cabang lama',{maxRows:null});
   for(const id of ids){const branch=legacy.find(row=>row.id===id);branches.push({id,code:branch?.code??'—',name:branch?`${branch.name} (target lama/nonaktif)`:'Cabang target lama tidak tersedia',selectable:false});}
  }
 return {items,branches,categories,hasLegacy:missing.length>0||missingBranches.length>0};
}
export default async function EditPromoPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 const {data:me}=await db.from('profiles').select('role,is_active').eq('id',user?.id??'').maybeSingle();
 if(!user||!me?.is_active||!['OWNER','ADMIN'].includes(me.role))return <>{back}<p role="alert">Hanya owner/manajer aktif yang bisa mengatur promo.</p></>;
 if(!/^[0-9a-f-]{36}$/i.test(id))return <>{back}<p role="alert">Promo tidak ditemukan atau tidak dapat diakses.</p></>;
 const {data,error}=await db.rpc('read_promo_edit',{p_id:id});
 if(error||!data)return <>{back}<p role="alert">Data promo belum dapat dimuat. Muat ulang atau kembali ke daftar; perubahan belum disimpan.</p></>;
 const snapshot=data as PromoEditSnapshot;
 let options:Awaited<ReturnType<typeof loadOptions>>|null=null;
 try {options=await loadOptions(db,snapshot);}catch { /* Incomplete source reads must not expose a partial editor. */ }
 if(!options)return <>{back}<p role="alert">Pilihan barang/cabang/kategori belum dapat dimuat lengkap. Muat ulang sebelum mengedit; target promo tidak diubah.</p></>;
 const {items,branches,categories,hasLegacy}=options;
  return <>
   <div style={{display:'flex',flexWrap:'wrap',gap:8}}>{back}<ActivityHistoryLink entity="promos" id={id}/></div>
   <h1>Edit promo</h1><p>{snapshot.promo.name} · {snapshot.promo.is_active?'Aktif':'Nonaktif'}</p>
   <p>Perubahan berlaku untuk penggunaan promo berikutnya. Diskon dan nilai transaksi yang sudah tersimpan tidak dihitung ulang.</p>
   <p>Riwayat aktivitas mencatat pelaku, waktu, dan rincian perubahan yang tersedia. Teks saran tidak disalin ke riwayat.</p>
   {hasLegacy&&<p role="status">Target lama/nonaktif tetap dipilih. Lepaskan secara eksplisit jika ingin mengubahnya; pilihan baru hanya dari daftar aktif.</p>}
   <div className="crm-sec"><PromoEditor key={`${user.id}:${id}:${snapshot.version}`} userId={user.id} snapshot={snapshot} items={items} branches={branches} categories={categories} packageTotal={packageTotalReleased()}/></div>
  </>;

}
