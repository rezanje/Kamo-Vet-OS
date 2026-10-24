import Decimal from 'decimal.js';

// Import source components are limited to80 characters by the existing SQL.
// Keep enough working digits for their products and a full batch sum.
export const StockDecimal=Decimal.clone({precision:2000,rounding:Decimal.ROUND_HALF_UP});
export type StockDecimalPreview={quantity:string;source_value:string;rounded_value:string;rounding_delta:string;source_evidence_complete?:boolean};

/** Native numeric XLSX cells bypass locale parsing. Text accepts unambiguous
 * dot/comma decimals; legacy dot-only 3-digit grouping remains Indonesian.
 */
export function stockNumberText(input:string):string{
 const text=input.trim();if(!text)return '';
 const match=text.match(/^([+-]?[\d.,]+)([eE][+-]?\d+)?$/);if(!match)return 'NaN';
 let body=match[1];const exponent=match[2]??'';
 if(body.includes('.')&&body.includes(',')){
  if(body.lastIndexOf(',')>body.lastIndexOf('.')){
   if(!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(body))return 'NaN';
   body=body.replace(/\./g,'').replace(',','.');
  }else{
   if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)\.\d+$/.test(body))return 'NaN';
   body=body.replace(/,/g,'');
  }
 }else if(body.includes(',')){
  if((body.match(/,/g)??[]).length>1){if(!/^[+-]?\d{1,3}(?:,\d{3})+$/.test(body))return 'NaN';body=body.replace(/,/g,'');}
  else body=body.replace(',','.');
 }else if(!exponent&&/^[+-]?[1-9]\d{0,2}(?:\.\d{3})+$/.test(body))body=body.replace(/\./g,'');
 const value=body+exponent;
 return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)?value:'NaN';
}

export function formatImportDecimal(input:string|number,signed=false,minimumDecimals=0):string{
 const value=new StockDecimal(input);if(!value.isFinite())return '—';
 const [whole,fraction]=value.toFixed(Math.max(minimumDecimals,value.decimalPlaces())).split('.');
 return (signed&&value.gt(0)?'+':'')+whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(fraction?','+fraction:'');
}

export function stockDecimalPreview(rows:readonly {status:string;baseQty:number;baseQtyExact?:string;value:number;valueExact?:string;sourceValues?:{qty:string;unit_cost:string}[]}[]):StockDecimalPreview{
 let quantity=new StockDecimal(0),source=new StockDecimal(0);
 for(const row of rows.filter(r=>r.status==='valid')){
  quantity=quantity.plus(row.baseQtyExact??row.baseQty);
  source=source.plus(row.sourceValues?.length?row.sourceValues.reduce((sum,v)=>sum.plus(new StockDecimal(v.qty).times(v.unit_cost)),new StockDecimal(0)):row.valueExact??row.value);
 }
 const rounded=source.toDecimalPlaces(2);
 return {quantity:quantity.toFixed(),source_value:source.toFixed(),rounded_value:rounded.toFixed(2),rounding_delta:rounded.minus(source).toFixed(),source_evidence_complete:rows.filter(r=>r.status==='valid').every(r=>Boolean(r.sourceValues?.length))};
}
