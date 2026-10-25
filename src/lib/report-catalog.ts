import {TILES,type Tile} from './nav';
import {bolehBukaPath,type AturanTersimpan} from './akses';
import {REQUESTED_REPORTS} from './report-catalog-requirements';

export type CatalogReport = Tile & {key:string;groups:string[];coverage:string[];notes:string[];gaps:string[];status:'available'|'restricted'|'missing'};
export const REPORT_GROUPS=['Penjualan & operasional','Keuangan','Pembelian','Persediaan','Aset tetap','Marketing & pelanggan','Klinik','HRIS','Pajak'];
function category(tile:Tile):string {
  const path=tile.href??'';
  if(/SPT|Bukti Potong/.test(tile.label))return 'Pajak';
  if(tile.label==='Laporan HPP')return 'Persediaan';
  if(path.startsWith('/keuangan/')||path.startsWith('/kas-bank/')||path==='/pos/shift')return 'Keuangan';
  if(/\/(absensi|gaji|kpi)$/.test(path))return 'HRIS';
  if(/\/(rekap-klinik|anamnesa|jadwal-anabul)$/.test(path))return 'Klinik';
  if(/\/(retensi|member|akuisisi|promo)$/.test(path))return 'Marketing & pelanggan';
  if(path==='/laporan/pembelian')return 'Pembelian';
  return 'Penjualan & operasional';
}
export function buildReportCatalog(role:string,rules:AturanTersimpan):CatalogReport[] {
  const rows=new Map<string,CatalogReport>();
  function add(tile:Tile,group:string) {
    const key=tile.href??`missing:${tile.label}`;
    if(!rows.has(key))rows.set(key,{...tile,key,groups:[group],coverage:[],notes:[],gaps:[],status:tile.href?'available':'missing'});
    const row=rows.get(key)!;
    if(!row.groups.includes(group))row.groups.push(group);
    return row;
  }
  for(const tile of TILES.laporan)add(tile,category(tile));
  for(const request of REQUESTED_REPORTS){
    const row=add({label:request.label,href:request.href,icon:'ti-report',bg:'#eff6ff',fg:'#2563eb'},request.group);
    row.coverage.push(request.label);
    if(request.note&&!row.notes.includes(request.note))row.notes.push(request.note);
    if(request.gap&&!row.gaps.includes(request.gap))row.gaps.push(request.gap);
  }
  // Keep the established narrower HPP entry-point visibility.
  if(['OWNER','FINANCE'].includes(role)){
    add({label:'Nilai Persediaan FIFO',href:'/laporan/nilai-persediaan',icon:'ti-package',bg:'#f0fdf4',fg:'#15803d'},'Persediaan');
    add({label:'HPP & Margin Racikan',href:'/laporan/margin-racikan',icon:'ti-flask',bg:'#f0fdf4',fg:'#15803d'},'Persediaan');
    add({label:'Hasil Stok Opname',href:'/laporan/hasil-opname',icon:'ti-clipboard-check',bg:'#f0fdf4',fg:'#15803d'},'Persediaan');
  }
  return [...rows.values()].map(row=>row.href&&!bolehBukaPath(role,row.href,rules)?{...row,href:undefined,status:'restricted'}:row);
}
