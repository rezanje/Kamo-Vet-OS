import Link from "next/link";
import { notFound } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { MonetaryOpeningForm } from "./MonetaryOpeningForm";

const rp = (value: number) => `Rp ${Number(value).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;

export default async function MonetaryOpeningPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const { error, success } = await searchParams;
  const supabase = await assertRole("/kas-bank/rekening", "saldo awal moneter", ["OWNER"]);
  const { data: { user } } = await supabase.auth.getUser();
  const { data: account, error: accountError } = await supabase.from("cash_accounts").select("id,nama,coa_code").eq("id", id).maybeSingle();
  if (accountError) throw new Error("Rekening belum dapat dibaca. Muat ulang sebelum mengoreksi.");
  if (!account || !user) notFound();
  const { data: history, error: historyError } = await supabase.from("monetary_opening_corrections")
    .select("id,revision,reason,old_amount,new_amount,created_at,profiles(full_name)")
    .eq("cash_account_id", id).order("revision", { ascending: false }).limit(20);
  if (historyError) throw new Error("Riwayat koreksi belum dapat dibaca. Muat ulang sebelum mengoreksi.");
  return <>
    <Link href={`/kas-bank/rekening/${id}`} className="back-btn">Kembali ke buku mutasi</Link>
    <h1>Koreksi saldo awal · {account.nama}</h1>
    {error && <div role="alert" className="p2ban">{error}</div>}
    {success && <div role="status" className="p2ban">{success}</div>}
    <div className="crm-sec"><MonetaryOpeningForm userId={user.id} accountId={id} /></div>
    <div className="crm-sec" style={{ overflowX: "auto" }}>
      <h2>Riwayat koreksi</h2>
      <p>20 koreksi terakhir. Setiap catatan menyimpan pelaku, alasan, nilai lama/baru, preview, dan tautan jurnal pembalik/pengganti.</p>
      <table className="tbl"><thead><tr><th>Revisi / waktu</th><th>Lama</th><th>Baru</th><th>Alasan</th><th>Pelaku</th><th>Jurnal</th></tr></thead>
        <tbody>{(history ?? []).map(row => <tr key={row.id}>
          <td>{row.revision} · {new Date(row.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
          <td>{rp(row.old_amount)}</td><td>{rp(row.new_amount)}</td><td>{row.reason}</td><td>{(Array.isArray(row.profiles) ? row.profiles[0] : row.profiles)?.full_name ?? "Owner"}</td>
          <td><Link href={`/keuangan/jurnal?cari=${row.id}&sumber=cash-open-reversal`}>Pembalik</Link> · <Link href={`/keuangan/jurnal?cari=${row.id}&sumber=cash-open-replacement`}>Pengganti</Link></td>
        </tr>)}
        {!history?.length && <tr><td colSpan={6}>Belum ada koreksi saldo pembuka.</td></tr>}</tbody>
      </table>
    </div>
  </>;
}
