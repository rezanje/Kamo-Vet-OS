import type {PromoRow} from './promo';
export type PromoEditSnapshot={promo:PromoRow;item_ids:string[];version:string};
export type PromoEditValues={name:string;promo_type:string;suggest:string;min_subtotal:number|null;min_qty:number|null;max_qty:number|null;kelipatan:boolean;auto_apply:boolean;discount_type:string|null;discount_value:number|null;branch_ids:string[]|null;valid_from:string|null;valid_until:string|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function promoEditInput(form:FormData):{id:string;version:string;values:PromoEditValues;itemIds:string[]}{
 const text=(key:string)=>String(form.get(key)??'').trim();
 const number=(key:string)=>{const raw=text(key);if(!raw)return null;const n=Number(raw);if(!Number.isFinite(n))throw new Error('Angka promo tidak valid');return n;};
 const ids=(key:string)=>{const values=[...new Set(form.getAll(key).map(String).filter(Boolean))];if(values.some(id=>!uuid.test(id)))throw new Error('Pilihan promo tidak valid');return values;};
 const id=text('id'),version=text('version');
 if(!uuid.test(id)||!/^[a-f0-9]{32}$/.test(version))throw new Error('Data promo tidak lengkap. Muat ulang halaman.');
 const name=text('name'),suggest=text('suggest'),promo_type=text('promo_type'),discount_type=text('discount_type')||null;
 const discount_value=number('discount_value'),min_qty=number('min_qty'),max_qty=number('max_qty'),min_subtotal=number('min_subtotal');
 const kelipatan=text('kelipatan')==='1',auto_apply=text('auto_apply')==='1',valid_from=text('valid_from')||null,valid_until=text('valid_until')||null;
 if(!name||!suggest||name.length>120)throw new Error('Nama (maks. 120 karakter) & teks saran wajib diisi');
 if(!['diskon_produk','bundling','tebus_murah'].includes(promo_type))throw new Error('Tipe promo tidak valid');
 if(discount_type&&!['percent','nominal'].includes(discount_type))throw new Error('Jenis diskon tidak valid');
 if(discount_type&&(discount_value===null||discount_value<=0))throw new Error('Nilai diskon harus lebih dari 0');
 if(discount_type==='percent'&&discount_value!>100)throw new Error('Diskon persen tidak boleh lebih dari 100%');
 if(min_qty!==null&&min_qty<=0)throw new Error('Min. qty harus lebih dari 0');
 if(max_qty!==null&&max_qty<=0)throw new Error('Maks. qty harus lebih dari 0');
 if(min_qty!==null&&max_qty!==null&&max_qty<min_qty)throw new Error('Maks. qty tidak boleh lebih kecil dari min. qty');
 if(min_subtotal!==null&&min_subtotal<0)throw new Error('Min. subtotal tidak boleh negatif');
 for(const date of [valid_from,valid_until])if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw new Error('Tanggal promo tidak valid');
 if(valid_from&&valid_until&&valid_until<valid_from)throw new Error('Tanggal berakhir lebih awal dari tanggal mulai');
 if(auto_apply&&(!discount_type||discount_value===null))throw new Error('Potong otomatis butuh jenis & nilai diskon terisi');
 if(auto_apply&&kelipatan&&min_qty===null)throw new Error('Aturan kelipatan butuh min. qty terisi');
 const branchIds=ids('branch_ids');
 return {id,version,itemIds:ids('item_ids'),values:{name,promo_type,suggest,min_subtotal,min_qty,max_qty,kelipatan,auto_apply,discount_type,discount_value,branch_ids:branchIds.length?branchIds:null,valid_from,valid_until}};
}
