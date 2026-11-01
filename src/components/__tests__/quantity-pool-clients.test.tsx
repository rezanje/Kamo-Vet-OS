// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {kasirDraftKey,POS_DRAFT_KEY} from '@/lib/pos-draft';
import type {PromoHitung} from '@/lib/promo-hitung';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('@/app/kasir/checkout',()=>({checkoutKasir:vi.fn()}));
vi.mock("@/app/kasir/actions", async () => (await import("./helpers/kasir-actions-mock")).kasirActionsMock);
vi.mock("@/app/(app)/pos/transaksi/actions", async () => (await import("./helpers/pos-actions-mock")).posActionsMock);
import {KasirClient} from '@/app/kasir/KasirClient';
import {PosClient} from '@/app/(app)/pos/transaksi/PosClient';
const context='pool:branch:shift';
const units=[{unit:'PCS',factor:1,sell_price:20000,buy_price:10000},{unit:'SAK',factor:25,sell_price:450000,buy_price:250000}];
const items=['a','b','c'].map(id=>({id,code:id,name:`Pakan ${id}`,itemType:'Persediaan' as const,harga:20000,kategori:'Pakan',stok:100,satuan:units}));
const pool:PromoHitung={id:'bolt',name:'Bolt campur varian',itemIds:['a','b'],discountMode:'quantity_pool',quantityPool:{version:1,unit:'PCS',normal_price:20000,tiers:[{qty:6,total:110000},{qty:2,total:38000}]},minQty:null,maxQty:null,kelipatan:true,autoApply:true,discountType:null,discountValue:null};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();sessionStorage.clear();});
async function render(kind:'kasir'|'backoffice',qty=2,legacyUnits=false){
 const catalog=legacyUnits?items.map(item=>({...item,satuan:[units[0]]})):items;
 const cart=[{row_key:'first',item_id:'a',nama:'Pakan a',qty:qty-1,harga:20000,satuan:'PCS',faktor:1,target_species:'Kucing'},{row_key:'second',item_id:'b',nama:'Pakan b',qty:1,harga:20000,satuan:'PCS',faktor:1,target_species:'Kucing'}];
 if(legacyUnits)cart.forEach(line=>{Reflect.deleteProperty(line,'satuan');Reflect.deleteProperty(line,'faktor');});
 const common={version:1,savedAt:Date.now(),checkoutKey:'pool-draft',customerId:'',salespersonId:'',metode:'Transfer',bayar:0,cart};
 sessionStorage.setItem(kind==='kasir'?kasirDraftKey(context):POS_DRAFT_KEY,JSON.stringify(kind==='kasir'?{...common,diskon:0,diskonPct:false,poin:0,voucher:''}:{...common,branchId:'branch',petId:'',discount:0}));
 await act(async()=>root.render(kind==='kasir'?<KasirClient branchName="Uji" items={catalog} vouchers={[]} hariIni="2026-11-01" draftContext={context} shiftId="shift" promoHitung={[pool]}/>:<PosClient items={catalog.map(i=>({id:i.id,code:i.code,name:i.name,item_type:i.itemType,sell_price:i.harga,units:i.satuan,target_species:'Kucing'}))} branches={[{id:'branch',code:'BR',name:'Uji'}]} promoPerCabang={{branch:[pool]}}/>));
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
}
it('kasir restores old single-unit drafts using the official base PCS rather than silently missing the pool',async()=>{
 await render('kasir',2,true);
 expect(host.querySelector('button.kpos-bayar')!.textContent?.trim()).toBe('Bayar Rp 38.000');
});
it.each(['kasir','backoffice'] as const)('%s displays mixed six-plus-two=148000',async kind=>{
 await render(kind,8);
 expect(host.querySelector('button.kpos-bayar,button.pay-btn')!.textContent?.trim()).toBe('Bayar Rp 148.000');
});
it.each(['kasir','backoffice'] as const)('%s displays mixed variant2=38000 and retains original cart identities',async kind=>{
 await render(kind);
 expect(host.querySelector('button.kpos-bayar,button.pay-btn')!.textContent?.trim()).toBe('Bayar Rp 38.000');
 const cart=JSON.parse(host.querySelector<HTMLInputElement>('input[name="cart"]')!.value);
 expect(cart.map((row:{item_id:string})=>row.item_id)).toEqual(['a','b']);
});
