import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { readCompleteList } from "@/lib/checked-list";
import { campaignBindingReadiness, type CampaignCalculationMode } from "@/lib/campaign-binding";
import { saveCampaignBinding, deleteCampaignBinding } from "./actions";

type Binding = {id:string;code:string;binding_type:string;voucher_id:string|null;promo_id:string|null;calculation_mode:CampaignCalculationMode};
type Source = {id:string;name?:string;code?:string};

export default async function CampaignBindingPage({searchParams}:{searchParams:Promise<{edit?:string;error?:string;saved?:string}>}) {
  const params=await searchParams;
  const canManage=await bolehKelolaMaster();
  if(!canManage)return <div className="p2ban">Relasi kode kampanye hanya dapat dikonfigurasi OWNER/ADMIN.</div>;
  const db=await createClient();
  const [bindings,vouchers,promos]=await Promise.all([
    readCompleteList<Binding>((from,to)=>db.from("campaign_code_bindings")
      .select("id,code,binding_type,voucher_id,promo_id,calculation_mode",{count:"exact"}).order("id").range(from,to),"Relasi kampanye",{maxRows:null}),
    readCompleteList<Source>((from,to)=>db.from("vouchers")
      .select("id,code",{count:"exact"}).order("id").range(from,to),"Voucher sumber",{maxRows:null}),
    readCompleteList<Source>((from,to)=>db.from("promos")
      .select("id,name",{count:"exact"}).order("id").range(from,to),"Promo sumber",{maxRows:null}),
  ]);
  const editing=bindings.find(b=>b.id===params.edit);
  return <div>
    <Link className="back-btn" href="/crm/promo">← Promo & Voucher</Link>
    <h1 style={{fontSize:20,margin:"16px 0 8px"}}>Relasi kode kampanye</h1>
    <div className="p2ban">Kode dengan sumber voucher transaksi dan mode perhitungan existing voucher dapat digunakan di kasir petshop dan pembayaran satu kunjungan klinik. Alias promo barang dan kode tanpa mode belum dapat digunakan. Batas pemakaian voucher transaksi dikelola di halaman Voucher.</div>
    {params.error&&<div role="alert" className="p2ban">{params.error}</div>}
    {params.saved&&<div className="p2ban">Relasi tersimpan. Status penggunaan setiap kode ditampilkan di tabel.</div>}
    <form action={saveCampaignBinding} className="crm-sec" style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:12}}>
      <input type="hidden" name="id" value={editing?.id??""}/>
      <label>Kode kampanye baru<input className="fi" name="code" required maxLength={24} defaultValue={editing?.code??""} placeholder="MISALPROMO10"/></label>
      <label>Jenis relasi<select className="fi" name="binding_type" defaultValue={editing?.binding_type??""} required>
        <option value="">Pilih jenis</option><option value="transaction_voucher">Voucher total transaksi</option><option value="product_promo">Promo barang</option>
      </select></label>
      <label>Sumber existing<select className="fi" name="target_id" defaultValue={editing?.voucher_id??editing?.promo_id??""} required>
        <option value="">Pilih sumber sesuai jenis</option>
        <optgroup label="Voucher transaksi">{vouchers.map(v=><option key={v.id} value={v.id}>{v.code}</option>)}</optgroup>
        <optgroup label="Promo barang">{promos.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
      </select></label>
      <label>Mode perhitungan<select className="fi" name="calculation_mode" defaultValue={editing?.calculation_mode??""}>
        <option value="">Belum dipilih — tidak dapat diredeem</option>
        <option value="existing_voucher">Pakai perhitungan voucher transaksi existing</option>
        <option value="existing_promo">Pakai perhitungan promo barang existing</option>
      </select></label>
      <div style={{gridColumn:"1 / -1"}}><button className="btn-acc" type="submit">{editing?"Simpan perubahan":"Simpan relasi"}</button>{editing&&<Link className="btn-def" href="/crm/kampanye">Batal edit</Link>}</div>
    </form>
    <section className="crm-sec"><h2 style={{fontSize:15}}>Relasi tersimpan</h2>
      <table className="tbl"><thead><tr><th>Kode</th><th>Jenis dan sumber</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
        {bindings.map(b=><tr key={b.id}><td>{b.code}</td><td>{b.binding_type==="transaction_voucher"?`Voucher ${vouchers.find(v=>v.id===b.voucher_id)?.code??"tidak tersedia"}`:`Promo ${promos.find(p=>p.id===b.promo_id)?.name??"tidak tersedia"}`}</td><td>{campaignBindingReadiness(b.calculation_mode)}</td><td><Link className="btn-def" href={`/crm/kampanye?edit=${b.id}`}>Ubah</Link><form action={deleteCampaignBinding} style={{display:"inline"}}><input type="hidden" name="id" value={b.id}/><button className="btn-def" type="submit">Hapus</button></form></td></tr>)}
        {!bindings.length&&<tr><td colSpan={4}>Belum ada relasi kampanye.</td></tr>}
      </tbody></table>
    </section>
  </div>;
}
