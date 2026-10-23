import { hitungPromoKeranjang, type PromoHitung, type PotonganBaris } from "./promo-hitung";

type PricingLine = { item_id: string; qty: number; harga: number; item_type?: string; row_key?: string; satuan?: string | null };
function groups<T extends PricingLine>(rows:T[]) {
  const result: {row:T;indexes:number[]}[]=[],indexByKey=new Map<string,number>();
  rows.forEach((row,index)=>{
    const service=row.item_type==="Jasa" || (row.item_type===undefined && !!row.row_key);
    const key=service?JSON.stringify([row.item_id,row.satuan??"",row.harga]):`line:${index}`;
    const at=indexByKey.get(key);
    if(at!==undefined){result[at].row.qty+=Number(row.qty);result[at].indexes.push(index);}
    else{indexByKey.set(key,result.length);result.push({row:{...row,qty:Number(row.qty)},indexes:[index]});}
  });
  return result;
}
/** Calculation-only grouping retains the pricing semantics before service rows were split. */
export function aggregateServiceLines<T extends PricingLine>(cart:T[]):T[]{return groups(cart).map(group=>group.row);}

/** One existing promo decision per original service SKU/unit/price group, one saved allocation per source row. */
export function serviceLinePromos<T extends PricingLine>(promos:PromoHitung[],cart:T[]):(PotonganBaris & {lineIndex:number})[]{
  const grouped=groups(cart),rows=grouped.map((group,index)=>({...group.row,item_id:`line:${index}`}));
  // Synthetic identities prevent a second same-SKU result from overwriting an allocation.
  const mapped=promos.map(promo=>({...promo,itemIds:promo.itemIds.length?grouped.flatMap((group,index)=>promo.itemIds.includes(group.row.item_id)?[`line:${index}`]:[]):[]}));
  // A targeted promo with no match must not turn into the engine's "all products" empty scope.
  const eligible=mapped.filter((promo,index)=>promos[index].itemIds.length===0 || promo.itemIds.length>0);
  return hitungPromoKeranjang(eligible,rows).flatMap(result=>{
    const group=grouped[Number(result.item_id.slice(5))];
    let left=result.potongan;
    return group.indexes.map((lineIndex,index)=>{
      const last=index===group.indexes.length-1;
      const amount=last?left:Math.min(left,Math.floor(result.potongan*Number(cart[lineIndex].qty)/group.row.qty));
      left-=amount;
      return {...result,item_id:group.row.item_id,potongan:amount,qtyKena:result.qtyKena*Number(cart[lineIndex].qty)/group.row.qty,lineIndex};
    });
  }).sort((a,b)=>a.lineIndex-b.lineIndex);
}
