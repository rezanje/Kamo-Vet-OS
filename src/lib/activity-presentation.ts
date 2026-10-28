import type {SupabaseClient} from '@supabase/supabase-js';
import type {ActivityRow} from './activity-log';
import {relatedDocumentHref} from './related-document-routes';
import {canUseBranch,type AllowedBranches} from './branch-access';
import Decimal from 'decimal.js';

// Presentation only. This list does not authorize capture or reading a field.
const FIELDS: Record<string,string> = {
 qty:'Jumlah',harga:'Harga',harga_beli:'Harga beli',sell_price:'Harga jual',buy_price:'Harga beli',
 qty_terima:'Jumlah diterima',qty_pesan:'Jumlah dipesan',qty_rusak:'Jumlah rusak',qty_kirim:'Jumlah dikirim',qty_faktur:'Jumlah difakturkan',
 qty_sisa_sebelum:'Sisa sebelum penerimaan',qty_diminta:'Jumlah diminta',qty_diterima:'Jumlah diterima',qty_ordered:'Jumlah dipesan',qty_received:'Jumlah diterima',
 qty_sistem:'Jumlah menurut sistem',qty_baru:'Jumlah sesudah penyesuaian',qty_fisik:'Jumlah fisik',selisih:'Selisih',
 qty_per_group:'Jumlah per grup',selected_qty:'Jumlah dalam satuan pilihan',total_base_qty:'Jumlah dalam satuan dasar',
 factor:'Faktor konversi satuan',faktor:'Faktor konversi satuan',hpp:'Harga pokok',nilai:'Nilai',
 min_stock:'Stok minimum',min_qty:'Jumlah minimum',max_qty:'Jumlah maksimum',kelipatan:'Kelipatan',
 total:'Total',subtotal:'Subtotal',dpp:'Dasar pengenaan pajak',ppn:'PPN',tax:'Pajak',discount:'Diskon',diskon_persen:'Diskon (%)',discount_value:'Nilai diskon',
 item_discount_value:'Diskon barang',promo_discount:'Diskon promo',jumlah:'Jumlah uang',amount:'Jumlah uang',
 bayar:'Dibayar',kembali:'Kembalian',terpakai:'Terpakai',carried_paid:'Pembayaran sebelumnya',
 dp_amount:'Uang muka',dp_date:'Tanggal uang muka',metode_bayar:'Metode pembayaran',
 biaya_admin:'Biaya administrasi',biaya_adm:'Biaya administrasi',bunga:'Bunga',saldo_bank:'Saldo bank',saldo_buku:'Saldo buku',
 opening_balance:'Saldo pembukaan',closing_balance:'Saldo penutupan',expected_cash:'Kas yang diharapkan',
 nilai_masuk:'Nilai masuk',nilai_keluar:'Nilai keluar',harga_perolehan:'Harga perolehan',nilai_sisa:'Nilai sisa',umur_bulan:'Umur (bulan)',
 tanggal:'Tanggal',tanggal_perolehan:'Tanggal perolehan',tanggal_mulai:'Tanggal mulai',jatuh_tempo:'Jatuh tempo',rencana_kirim:'Rencana pengiriman',
 paid_at:'Waktu pelunasan',received_at:'Waktu penerimaan',voided_at:'Waktu pembatalan',voided_on:'Tanggal pembatalan',
 trashed_at:'Waktu masuk arsip',disbursed_at:'Waktu pencairan',opened_at:'Waktu pembukaan',closed_at:'Waktu penutupan',
 is_active:'Aktif',auto_apply:'Diterapkan otomatis',status:'Status',paid_status:'Status pembayaran',marketplace_status:'Status marketplace',
 code:'Kode',revision:'Revisi',lifecycle_revision:'Revisi status barang',correction_revision:'Revisi koreksi',correction_pending:'Menunggu koreksi',
 jenis:'Jenis',proses:'Proses',priority:'Prioritas',condition:'Kondisi',kondisi:'Kondisi',alasan:'Alasan',
 tier:'Tingkat loyalitas',points:'Poin',total_spending:'Total belanja',sort_order:'Urutan',
 target_value:'Target',points_reward:'Hadiah poin',is_completed:'Selesai',current_value:'Pencapaian',
 qty_remaining:'Jumlah tersisa',unit_cost:'Biaya per satuan',total_cost:'Total biaya',
 activated_at:'Waktu aktivasi',approved_at:'Waktu persetujuan',locked_at:'Waktu penguncian',closed_through:'Ditutup sampai tanggal',
 average_after:'Rata-rata sesudah',average_before:'Rata-rata sebelum',average_cost:'Biaya rata-rata',
 akumulasi:'Akumulasi',batch:'Batch',credit:'Kredit',debit:'Debit',dari_uang_muka:'Dari uang muka',exp_date:'Kedaluwarsa',fifo_shortfall:'Kekurangan lapisan FIFO',
 harga_jual:'Harga jual',laba_rugi:'Laba / rugi',nilai_bahan:'Nilai bahan',nilai_baru:'Nilai baru',nilai_buku:'Nilai buku',nilai_lama:'Nilai lama',
 output_qty:'Jumlah hasil',points_cost:'Biaya poin',qty_after:'Jumlah sesudah',qty_delta:'Perubahan jumlah',qty_in:'Jumlah masuk',qty_jadi:'Jumlah hasil',qty_left:'Jumlah tersisa',
 rencana_bayar:'Rencana pembayaran',streak_bonus_every_days:'Interval bonus (hari)',streak_bonus_points:'Bonus poin',tanggal_selesai:'Tanggal selesai',
 track_batch:'Lacak batch',track_expiry:'Lacak kedaluwarsa',umur_baru:'Umur baru',umur_lama:'Umur lama',
 valuation_adjustment:'Penyesuaian nilai',value:'Nilai',value_after:'Nilai sesudah',value_delta:'Perubahan nilai',variance:'Selisih nilai',
 doctor_required:'Wajib dokter',max_uses:'Batas pemakaian',active:'Aktif',restock:'Kembali ke stok',row_no:'Nomor baris',
 outstanding:'Sisa tagihan',original_total:'Total awal faktur',ap_count:'Jumlah faktur hutang',ap_total:'Total hutang',
 ar_count:'Jumlah faktur piutang',ar_total:'Total piutang',
 catatan:'Catatan',name:'Nama',nama:'Nama',item_id:'Barang',supplier_id:'Pemasok',customer_id:'Pelanggan',branch_id:'Cabang',
};
const DATES=new Set(['tanggal','tanggal_perolehan','tanggal_mulai','tanggal_selesai','jatuh_tempo','rencana_kirim','rencana_bayar','dp_date','exp_date','paid_at','received_at','voided_at','voided_on','trashed_at','disbursed_at','opened_at','closed_at','activated_at','approved_at','locked_at','closed_through']);
const TEXT=new Set(['code','status','paid_status','marketplace_status','jenis','proses','priority','condition','kondisi','alasan','tier','metode_bayar']);
const STATUS:Record<string,string>={draft:'Draf',Draft:'Draf',pending:'Menunggu',active:'Aktif',disposed:'Dilepas',true:'Ya',false:'Tidak',normal:'Normal',tinggi:'Tinggi',baik:'Baik',kurang:'Kurang',rusak:'Rusak',hilang:'Hilang',kadaluarsa:'Kedaluwarsa',lainnya:'Lainnya',temuan:'Temuan',belum:'Belum',lunas:'Lunas'};

export function activityFieldLabel(field:string):string {
 return Object.hasOwn(FIELDS,field)?FIELDS[field]:'Bagian lainnya';
}
/** Never renders unknown/nested payloads or turns display labels into permission. */
export function activityValue(field:string,value:unknown):string {
 if(!Object.hasOwn(FIELDS,field))return 'Nilai disamarkan';
 if(value===undefined)return '—';
 if(value===null)return 'Kosong';
 if(field==='code')return typeof value==='string'&&value.length<=160?value:'Nilai disamarkan';
 if(typeof value==='boolean')return value?'Ya':'Tidak';
 if(DATES.has(field)&&typeof value==='string'){
  if(/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value)
   return new Date(value+'T00:00:00+07:00').toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'medium'});
  if(/^\d{4}-\d{2}-\d{2}T[\d:.+Z-]+$/.test(value)&&!Number.isNaN(Date.parse(value)))
   return new Date(value).toLocaleString('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'medium',timeStyle:'medium'})+' WIB';
  return 'Nilai disamarkan';
 }
 // Format decimal strings without a Number conversion or rounding source values.
 const numeric=typeof value==='number'&&Number.isFinite(value)?new Decimal(value).toFixed():value;
 if(typeof numeric==='string'&&numeric.length<=200&&/^-?\d+(?:\.\d+)?$/.test(numeric)){
  const [whole,fraction]=numeric.split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(fraction?','+fraction:'');
 }
 if(TEXT.has(field)&&typeof value==='string'&&value.length<=160)return STATUS[value]??value;
 return 'Nilai disamarkan';
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_ROUTES:Record<string,(id:string)=>string|null>={
 purchase_orders:id=>relatedDocumentHref('purchase-order',id),
 goods_receipts:id=>relatedDocumentHref('goods-receipt',id),
 purchase_invoices:id=>relatedDocumentHref('purchase-invoice',id),
 purchase_returns:id=>relatedDocumentHref('purchase-return',id),
 sales_invoices:id=>relatedDocumentHref('sales-invoice',id),
 sales_orders:id=>`/penjualan/pesanan/${id}`,
 sales_returns:id=>`/penjualan/retur/${id}`,
 sales:id=>`/pos/struk/${id}`,
};
export const activitySourceKey=(entity:string,id:string)=>JSON.stringify([entity,id]);
const SOURCE_SELECT:Record<string,string>={
 sales:'id,branch_id,channel',
 goods_receipts:'id,purchase_orders(branch_id)',purchase_returns:'id,purchase_orders(branch_id)',
 purchase_invoices:'id,branch_id,purchase_orders(branch_id)',sales_returns:'id,sales(branch_id)',
};
function sourceBranches(entity:string,source:Record<string,unknown>):unknown[]{
 const parent=entity==='sales_returns'?source.sales:source.purchase_orders;
 const parents=(Array.isArray(parent)?parent:[parent]).filter((p):p is Record<string,unknown>=>!!p&&typeof p==='object');
 if(entity==='goods_receipts'||entity==='purchase_returns'||entity==='sales_returns')return parents.length?parents.map(p=>p.branch_id):[undefined];
 if(entity==='purchase_invoices'&&source.branch_id==null)return parents.length?parents.map(p=>p.branch_id):[undefined];
 return [source.branch_id];
}

/** Only live root identities read by this session's ordinary RLS client gain links.
 * Child IDs/document numbers are never guessed; destination guards remain authoritative.
 */
export async function activitySourceLinks(db:SupabaseClient,rows:ActivityRow[],allowed:AllowedBranches=[]):Promise<{links:Map<string,string>;unavailable:boolean}>{
 const groups=new Map<string,Set<string>>();const links=new Map<string,string>();let unavailable=false;
 for(const row of rows){
  if(row.action==='delete'||!Object.hasOwn(SOURCE_ROUTES,row.entity)||!UUID.test(row.entity_id))continue;
  const ids=groups.get(row.entity)??new Set<string>();ids.add(row.entity_id);groups.set(row.entity,ids);
 }
 await Promise.all([...groups].map(async([entity,ids])=>{
  try{
   const {data,error}=await db.from(entity).select(SOURCE_SELECT[entity]??'id,branch_id').in('id',[...ids]);
   if(error||!Array.isArray(data)){unavailable=true;return;}
   for(const candidate of data as unknown[]){
    if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))continue;
    const source=candidate as Record<string,unknown>;
    if(typeof source.id!=='string'||!ids.has(source.id))continue;
    if(entity==='sales'&&source.channel!==null)continue;
    // Some legacy sources have permissive SELECT policies. Recheck current
    // account branch grants instead of treating a historic audit scope as current.
    if(allowed!==null&&!sourceBranches(entity,source).every(branch=>typeof branch==='string'&&canUseBranch(allowed,branch)))continue;
    const href=SOURCE_ROUTES[entity](source.id);if(href)links.set(activitySourceKey(entity,source.id),href);
   }
  }catch{unavailable=true;}
 }));
 return {links,unavailable};
}
