"use client";
import {SubmitButton} from "@/components/SubmitButton";
import {PreservedForm} from '@/components/LocalTransactionDraft';
import type {MultiSelectItem,MultiSelectCategory} from '@/components/SearchableMultiSelect';
import type {PromoEditSnapshot} from '@/lib/promo-edit';
import {PromoFields} from './PromoFields';
import {editPromo} from './actions';
import styles from './PromoForm.module.css';
export function PromoEditor({userId,snapshot,items,branches,categories,packageTotal=false}:{userId:string;snapshot:PromoEditSnapshot;items:MultiSelectItem[];branches:MultiSelectItem[];categories:MultiSelectCategory[];packageTotal?:boolean}){
 if(snapshot.promo.rule?.discount_mode==='quantity_pool')return <div role="alert">Promo quantity pool: {snapshot.promo.name}. Aturan campur varian ini tidak dapat diubah melalui editor lama. Hubungi admin rilis untuk perubahan aturan, target, atau jadwal.</div>;
 const save=async(form:FormData)=>{const result=await editPromo(form);if(result?.ok===false)throw new Error(result.message);};
 return <PreservedForm action={save} className={styles.form}>
  <input type="hidden" name="id" value={snapshot.promo.id}/><input type="hidden" name="version" value={snapshot.version}/>
  <PromoFields userId={userId} items={items} branches={branches} categories={categories} promo={snapshot.promo} itemIds={snapshot.item_ids} scope={`crm-promo-edit:${snapshot.promo.id}:${snapshot.version}`} packageTotal={packageTotal}/>
  <SubmitButton pendingText="Menyimpan perubahan…" className="btn-acc" style={{gridColumn:'1 / -1',justifyContent:'center'}}>Simpan perubahan promo</SubmitButton>
 </PreservedForm>;
}
