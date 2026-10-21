import { BankReconciliationRecovery } from "../BankReconciliationRecovery";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountBalances } from "@/lib/ledger";
import { hariIniWIB } from "@/lib/tanggal";
import { RekonForm, RekonVoidForm, type RekonHeader } from "../RekonForm";

export default async function RekonsiliasiDetail({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const { success, error } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: record, error: recordError } = await supabase.from("bank_reconciliations").select("*").eq("id",id).maybeSingle();
  if (recordError) throw new Error("Rekonsiliasi belum dapat diperiksa.");
  if (!record || !user) notFound();
  const [{ data: profile }, balances, banks, revisions] = await Promise.all([
    supabase.from("profiles").select("role,is_active").eq("id",user.id).maybeSingle(),
    getAccountBalances(supabase as never),
    supabase.from("cash_accounts").select("id,nama,coa_code").eq("jenis","Bank").eq("is_active",true).order("nama"),
    supabase.from("bank_reconciliation_revisions").select("id,action,reason,created_at,profiles(full_name)").eq("reconciliation_id",id).order("created_at"),
  ]);
  if (banks.error || revisions.error) throw new Error("Rincian rekening atau riwayat perubahan belum dapat dimuat.");
  const rekening = (banks.data ?? []).map(b => ({ ...b, saldo: balances.find(v=>v.code===b.coa_code)?.saldo ?? 0 }));
  const owner = profile?.is_active && profile.role === "OWNER";
  const header = record as RekonHeader;
  const rp = (value: number) => `Rp ${Number(value).toLocaleString("id-ID", {maximumFractionDigits:2})}`;
  return <>
    <BankReconciliationRecovery userId={user.id}/>
    <Link href="/keuangan/rekonsiliasi" className="back-btn">Kembali ke rekonsiliasi</Link>
    <h2>Rekonsiliasi {record.tanggal}</h2>
    {success && <div className="p2ban" role="status">{record.voided_at ? "Rekonsiliasi dibatalkan; penyesuaian lama sudah dibalik." : "Rekonsiliasi tersimpan beserta penyesuaiannya."}</div>}
    {error && <div className="p2ban" role="alert">{error}</div>}
    <div className="crm-sec">
      <p>Status: {record.voided_at ? "Dibatalkan" : "Aktif"} · Revisi {record.revision}</p>
      <p>Saldo buku sebelum penyesuaian: {rp(record.saldo_buku)} · Saldo bank: {rp(record.saldo_bank)}</p>
      <p>Biaya admin: {rp(record.biaya_adm)} · Bunga: {rp(record.bunga)} · Selisih: {rp(record.selisih)}</p>
      <p>{record.catatan}</p>
    </div>
    {owner && !record.voided_at && <>
      <div className="crm-sec"><h3>Koreksi rekonsiliasi</h3><RekonForm key={`${user.id}:${id}:${record.revision}`} userId={user.id} rekening={rekening} hariIni={hariIniWIB()} header={header}/></div>
      <div className="crm-sec"><h3>Batalkan rekonsiliasi</h3><RekonVoidForm key={`${user.id}:${id}:${record.revision}`} userId={user.id} header={header}/></div>
    </>}
    <div className="crm-sec"><h3>Riwayat perubahan</h3>
      {(revisions.data ?? []).map(r => {
        const person = r.profiles as unknown as { full_name: string } | { full_name: string }[] | null;
        const name = (Array.isArray(person) ? person[0]?.full_name : person?.full_name) ?? "Pengelola";
        return <p key={r.id}>{new Date(r.created_at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})} · {name} · {r.action === "edit" ? "Koreksi" : "Pembatalan"} · {r.reason}</p>;
      })}
      {!revisions.data?.length && <p>Belum ada perubahan.</p>}
    </div>
  </>;
}
