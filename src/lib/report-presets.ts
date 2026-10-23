/** Browser-local preferences only. Destinations still run normal report authorization. */
export type ReportPreset = {id:string;name:string;href:string;savedAt:string};
const paths=new Set(['absensi','nilai-persediaan','gaji','rekap-klinik','transaksi-cabang','jadwal-anabul','margin-racikan','akuisisi','operasional-penjualan','pelanggan-harian','penjual','penjualan-barang','member','penjualan-rinci','pelanggan-teratas','retensi','penjualan-kasir','anamnesa','pembelian','kpi','promo']);
const filters=new Set(['dari','sampai','periode','cabang','gudang','dokter','q','masalah','rincian','kanal','jenis','horizon','preset','from','to','channel','branch','ambang','cari']);
export function reportPresetKey(userId:string){if(!userId)throw Error('Akun belum tersedia.');return `vetos:report-presets:v1:${userId}`;}
export function reportPresetHref(path:string,query:string):string {
 if(!path.startsWith('/laporan/')||!paths.has(path.slice(9)))throw Error('Tujuan laporan tidak didukung.');
 if(query.length>8000)throw Error('Filter terlalu panjang.');
 const clean=new URLSearchParams();let count=0;
 for(const [key,value] of new URLSearchParams(query))if(filters.has(key)){
  if(value.length>1000||++count>100)throw Error('Filter terlalu panjang.');
  clean.append(key,value);
 }
 return path+(clean.size?`?${clean}`:'');
}
function validate(value:unknown):ReportPreset {
 if(!value||typeof value!=='object')throw Error('Konfigurasi tidak valid.');
 const x=value as Record<string,unknown>;
 if(typeof x.id!=='string'||!x.id||x.id.length>100||typeof x.name!=='string'||!x.name.trim()||x.name.length>80||typeof x.href!=='string'||x.href.length>8000||typeof x.savedAt!=='string'||!Number.isFinite(Date.parse(x.savedAt)))throw Error('Konfigurasi tidak valid.');
 const [path,query='']=x.href.split('?');
 if(reportPresetHref(path,query)!==x.href)throw Error('Konfigurasi tidak valid.');
 return {id:x.id,name:x.name.trim(),href:x.href,savedAt:x.savedAt};
}
export function readReportPresets(raw:string|null):ReportPreset[]{
 if(raw===null)return [];if(raw.length>450000)throw Error('Konfigurasi terlalu besar.');
 const value:unknown=JSON.parse(raw);if(!Array.isArray(value)||value.length>50)throw Error('Konfigurasi tidak valid.');
 const rows=value.map(validate);if(new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('ID konfigurasi ganda.');return rows;
}
export function saveReportPreset(rows:ReportPreset[],input:ReportPreset):ReportPreset[]{
 const saved=validate(input),others=rows.filter(x=>x.id!==saved.id);if(others.length>=50)throw Error('Maksimal 50 konfigurasi.');return [...others,saved];
}
