import Decimal from 'decimal.js';

// Import source components are limited to80 characters by the existing SQL.
// Keep enough working digits for their products and a full batch sum.
export const StockDecimal=Decimal.clone({precision:2000,rounding:Decimal.ROUND_HALF_UP});
export type StockDecimalPreview={quantity:string;source_value:string;rounded_value:string;rounding_delta:string;source_evidence_complete?:boolean;
 /** Keputusan pemilik 29 Okt (M04/M01): nilai tiap baris dibulatkan HALF_UP ke rupiah penuh. */
 line_rounded_value?:string;line_rounding_delta?:string;lines?:number};

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

type PreviewRow={status:string;baseQty:number;baseQtyExact?:string;value:number;valueExact?:string;sourceValues?:{qty:string;unit_cost:string}[];linePart?:number};

const lineSource=(row:PreviewRow)=>row.sourceValues?.length?row.sourceValues.reduce((sum,v)=>sum.plus(new StockDecimal(v.qty).times(v.unit_cost)),new StockDecimal(0)):new StockDecimal(row.valueExact??row.value);

/** Same rule as ROUND_LINE_RUPIAH_V1 in prepare_accurate_initial_stock: each source line is
 * round(qty*HPP, 0) HALF_UP. A line saved as two cent-rate layers (line_part 1 and 2) is one line;
 * part 1 repeats the line's source evidence, so only part 2 (or an unsplit row) counts it. */
export function lineRupiahRounding(rows:readonly PreviewRow[]){
 let source=new StockDecimal(0),rounded=new StockDecimal(0),lines=0;
 for(const row of rows){
  if(row.status!=='valid'||row.linePart===1)continue;
  const value=lineSource(row);
  source=source.plus(value);rounded=rounded.plus(value.toDecimalPlaces(0,StockDecimal.ROUND_HALF_UP));lines+=1;
 }
 return {source,rounded,delta:rounded.minus(source),lines};
}

export function stockDecimalPreview(rows:readonly PreviewRow[]):StockDecimalPreview{
 let quantity=new StockDecimal(0);
 const valid=rows.filter(r=>r.status==='valid');
 for(const row of valid)quantity=quantity.plus(row.baseQtyExact??row.baseQty);
 const line=lineRupiahRounding(valid);
 const rounded=line.source.toDecimalPlaces(2);
 return {quantity:quantity.toFixed(),source_value:line.source.toFixed(),rounded_value:rounded.toFixed(2),rounding_delta:rounded.minus(line.source).toFixed(),
  line_rounded_value:line.rounded.toFixed(0),line_rounding_delta:line.delta.toFixed(),lines:line.lines,
  source_evidence_complete:valid.every(r=>Boolean(r.sourceValues?.length))};
}
