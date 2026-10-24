import {formatImportDecimal,type StockDecimalPreview} from '@/lib/initial-stock-decimal';

export function InitialStockDecimalPreview({preview}:{preview?:StockDecimalPreview}) {
  if(!preview)return null;
  return <dl style={{fontSize:11,overflowWrap:'anywhere'}}>
    <dt>Jumlah stok dasar presisi penuh</dt><dd>{formatImportDecimal(preview.quantity)}</dd>
    <dt>{preview.source_evidence_complete===false?'Nilai batch tersimpan; bukti sumber belum lengkap (Rp)':'Nilai sumber presisi penuh (Rp)'}</dt><dd>{formatImportDecimal(preview.source_value)}</dd>
    <dt>Nilai uang setelah pembulatan 2 desimal (Rp)</dt><dd>{formatImportDecimal(preview.rounded_value,false,2)}</dd>
    <dt>Selisih pembulatan (Rp)</dt><dd>{formatImportDecimal(preview.rounding_delta,true)}</dd>
    <dd>Ini pratinjau pembulatan total batch, bukan bukti posting atau nilai kontrol eksternal. Jumlah stok tidak dibulatkan; normalisasi uang harus dipilih sebelum menyiapkan batch bila nilainya belum tepat dua desimal.</dd>
  </dl>;
}
