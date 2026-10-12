import Link from "next/link";
import { assertMasterAdmin } from "@/lib/master-guard";
import { readDemoPolicy } from "@/lib/clinic-demo-policy-server";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { SubmitButton } from "@/components/SubmitButton";
import { saveDemoPolicy } from "./actions";

export default async function DemoPolicyPage({ searchParams }: { searchParams: Promise<{error?: string;success?: string}> }) {
  const supabase = await assertMasterAdmin("/klinik/antrian", "aturan DEMO");
  const [policy, {data: accounts}, params] = await Promise.all([
    readDemoPolicy(supabase), supabase.from("coa_accounts").select("code,name,type,normal_balance")
      .eq("is_active",true).eq("is_header",false).in("type",["PENDAPATAN","BEBAN"]).order("code"), searchParams,
  ]);
  return <>
    <div className="pg-h"><h1>Aturan Klinik DEMO</h1><Link href="/klinik/antrian" className="btn-def">Kembali ke klinik</Link></div>
    {params.error && <div className="p2ban" role="alert">{params.error}</div>}
    {params.success && <div className="p2ban">Versi baru tersimpan untuk checkout berikutnya.</div>}
    <div className="card" style={{maxWidth:760}}>
      <p>Contoh aturan untuk percobaan. Berlaku saat checkout awal lunas, satu atau beberapa metode pembayaran. Invoice tersimpan tetap memakai versi aslinya.</p>
      <p>Satu pool insentif dihitung dari jasa sesudah diskon, sebelum pajak dan admin, lalu dibagi rata ke petugas yang dipilih. Sisa Rp1 dibagikan menurut urutan ID petugas.</p>
      <form action={saveDemoPolicy}>
        <label className="flab">Nama versi<input className="fi" name="name" maxLength={100} required defaultValue={policy?.name ?? "DEMO insentif 5% / admin Transfer 1%"}/></label>
        <label className="flab">Pool insentif jasa (%)<input className="fi" name="incentive_percent" type="number" min={0} max={100} step="0.01" required defaultValue={policy?.incentivePercent ?? 5}/></label>
        <label className="flab">Biaya admin ditanggung<select className="fi" name="fee_bearer" defaultValue={policy?.feeBearer ?? "customer"}><option value="customer">Pelanggan — ditambahkan setelah pajak</option><option value="company">Perusahaan — dicatat sebagai beban, mengurangi bank</option></select></label>
        {METODE_BAYAR.map(method => <label className="flab" key={method}>Admin {method} (%)<input className="fi" name={`fee:${method}`} type="number" min={0} max={100} step="0.01" required defaultValue={(policy?.feeRates[method] ?? (method==="Transfer" ? 100 : 0))/100}/></label>)}
        <label className="flab">Akun pendapatan admin<select className="fi" name="revenue_code" defaultValue={policy?.adminRevenueCode ?? "4303"}>{(accounts ?? []).filter(a=>a.type==="PENDAPATAN" && a.normal_balance==="K" && a.code!=="4201").map(a=><option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></label>
        <label className="flab">Akun beban admin<select className="fi" name="expense_code" defaultValue={policy?.adminExpenseCode ?? "5501"}>{(accounts ?? []).filter(a=>a.type==="BEBAN" && a.normal_balance==="D").map(a=><option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></label>
        <SubmitButton className="btn-acc" pendingText="Menyimpan…">Simpan versi baru</SubmitButton>
      </form>
    </div>
  </>;
}
