import {formatImportDecimal,type StockDecimalPreview} from '@/lib/initial-stock-decimal';
import {DEFAULT_VALUATION_POLICY} from '@/lib/initial-stock-valuation-policy';

export function InitialStockDecimalPreview({preview,policy=DEFAULT_VALUATION_POLICY}:{preview?:StockDecimalPreview;policy?:string}) {
  if(!preview)return null;
  const perLine=policy==='ROUND_LINE_RUPIAH_V1'&&preview.line_rounded_value!==undefined;
  return <dl aria-label="Pratinjau pembulatan nilai" style={{fontSize:11,overflowWrap:'anywhere'}}>
    <dt>Jumlah stok dasar presisi penuh</dt><dd>{formatImportDecimal(preview.quantity)}</dd>
    <dt>{preview.source_evidence_complete===false?'Nilai batch tersimpan; bukti sumber belum lengkap (Rp)':'Total sumber dari file, presisi penuh (Rp)'}</dt><dd>{formatImportDecimal(preview.source_value)}</dd>
    {perLine?<>
      <dt>Total setelah tiap baris dibulatkan ke rupiah penuh (Rp)</dt><dd>{formatImportDecimal(preview.line_rounded_value!,false,2)}</dd>
      <dt>Selisih pembulatan terhadap total sumber (Rp)</dt><dd>{formatImportDecimal(preview.line_rounding_delta??'0',true)}</dd>
      <dd>Pratinjau dari file, belum bukti posting. Nilai tiap baris = qty × HPP dibulatkan ke rupiah terdekat; jumlah stok tidak dibulatkan. Selisih ini disimpan bersama batch dan tampil lagi saat review posting.</dd>
    </>:<>
      <dt>Nilai uang setelah pembulatan 2 desimal (Rp)</dt><dd>{formatImportDecimal(preview.rounded_value,false,2)}</dd>
      <dt>Selisih pembulatan (Rp)</dt><dd>{formatImportDecimal(preview.rounding_delta,true)}</dd>
      <dd>Ini pratinjau pembulatan total batch, bukan bukti posting atau nilai kontrol eksternal. Jumlah stok tidak dibulatkan; normalisasi uang harus dipilih sebelum menyiapkan batch bila nilainya belum tepat dua desimal.</dd>
    </>}
  </dl>;
}
