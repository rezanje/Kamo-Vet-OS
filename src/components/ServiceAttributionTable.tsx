import Link from "next/link";
import type { BarisJual } from "@/lib/komisi";
import { servicePerformerNames } from "@/lib/service-performers";

export function ServiceAttributionTable({rows}:{rows:BarisJual[]}){
  const recorded=rows.filter(row=>row.servicePerformers || row.commissionPending);
  if(!recorded.length)return null;
  return <section className="crm-sec" style={{marginTop:12}}>
    <h2 style={{fontSize:13}}>Atribusi jasa dari baris asal</h2>
    <p style={{fontSize:11}}>Kasir dan dokter PIC tetap terpisah dari pelaksana. Setiap baris dihitung sekali untuk omzet sumber. Kebijakan komisi dua pelaksana harus dipilih dan aturannya cocok untuk keduanya; retur tanpa sumber pasti tetap tertahan. Pool DEMO tetap memakai snapshot yang sudah berlaku.</p>
    <div style={{overflowX:"auto"}}><table className="tbl" style={{minWidth:650}}>
      <thead><tr><th>Tanggal / sumber</th><th>Dokumen / baris</th><th>Pelaksana tersimpan</th><th>Qty / omzet neto</th><th>Perhitungan</th></tr></thead>
      <tbody>{recorded.map((row,index)=><tr key={`${row.sumber}:${row.sourceLineId}:${row.tanggal}:${index}`}>
        <td>{row.tanggal}<br/>{row.sumber}</td>
        <td>{row.sumber==="klinik"?<>{row.sourceDocumentNumber || "Nomor invoice belum tersedia"}{row.sourceDocumentHref && <div><Link href={row.sourceDocumentHref}>Pembayaran kunjungan saat ini</Link></div>}</>:row.sourceDocumentHref?<Link href={row.sourceDocumentHref}>{row.sourceDocumentNumber || "Buka dokumen asal"}</Link>:row.sourceDocumentNumber || "Sumber belum tersedia"}<div style={{fontSize:10,overflowWrap:"anywhere"}}>Baris: {row.sourceLineId || "Referensi retur belum lengkap"}</div></td>
        <td>{row.servicePerformers?servicePerformerNames(row.servicePerformers).map(name=><div key={name}>{name}</div>):"Atribusi belum dapat dipastikan"}</td>
        <td>{row.qty}<br/>Rp {row.omzet.toLocaleString("id-ID",{maximumFractionDigits:2})}</td>
        <td>{row.fixedCommission?"Snapshot pool DEMO":row.commissionPending?row.commissionPolicyWarning??"Perlu aturan / sumber — belum dihitung otomatis":row.commissionPolicy?`Kebijakan ${row.commissionPolicy==="personal_rules"?"aturan khusus karyawan, dasar penuh keduanya":row.commissionPolicy==="both_full"?"semua aturan, dasar penuh keduanya":"bagi dasar sesuai persentase"}`:row.employeeId?"Aturan komisi existing per pelaksana":"Pelaksana belum ditetapkan"}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
