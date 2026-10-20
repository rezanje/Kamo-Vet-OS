import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { bacaSaldoAwal } from "./actions";
import { SaldoAwalForm, BatalSaldoAwalForm } from "./SaldoAwalForm";
import { OpeningBalanceRecovery } from "./OpeningBalanceRecovery";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (s: string) => (s ? new Date(s.includes("T") ? s : s + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" }) : "—");

export default async function SaldoAwalPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const supabase = await createClient();
  const {data:{user}} = await supabase.auth.getUser();
  const {data:profile}=await supabase.from("profiles").select("role,is_active").eq("id",user?.id ?? "").maybeSingle();
  if(!profile?.is_active||!["OWNER","ADMIN","FINANCE"].includes(profile.role))return <div className="p2ban">Akses keuangan aktif diperlukan untuk saldo awal.</div>;
  const {data:allBranches,error:accessError}=await supabase.rpc("has_role_capability",{capability:"all_branches"});
  if(accessError||!allBranches)return <div className="p2ban">Saldo awal membutuhkan akses keuangan seluruh cabang.</div>;
  const { usulan, sudahAda, akun, barisAktif } = await bacaSaldoAwal(supabase);
  const {data:history}=await supabase.from("opening_balance_revisions").select("id,action,reason,created_at").order("created_at",{ascending:false}).limit(30);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Saldo Awal</span>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> {success}</div>}
      <OpeningBalanceRecovery userId={user?.id ?? ""}/>

      {sudahAda && (
        <div className="p2ban" style={{ background: "#eff6ff", border: ".5px solid #93c5fd", color: "#1d4ed8", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span>
            <i className="ti ti-info-circle" /> Saldo awal sudah tersimpan: {sudahAda.no_jurnal} per {fmtDate(sudahAda.tanggal)}.
            Koreksi memakai catatan pembalik; catatan lama tetap tersimpan.
          </span>
          {profile.role === "OWNER" && <details><summary>Batalkan</summary><BatalSaldoAwalForm userId={user?.id ?? ""} entryId={sudahAda.id}/></details>}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader
          num="01"
          title="YANG BELUM MASUK BUKU BESAR"
          desc="Perbandingan kondisi nyata (stok & daftar aset) dengan saldo akunnya. Selisih inilah yang bikin Neraca salah sebelum saldo awal diisi."
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 660 }}>
            <thead>
              <tr>
                <th>Akun</th><th>Dihitung dari</th>
                <th style={{ textAlign: "right" }}>Kondisi nyata</th>
                <th style={{ textAlign: "right" }}>Tercatat di buku</th>
                <th style={{ textAlign: "right" }}>Perlu dimasukkan</th>
              </tr>
            </thead>
            <tbody>
              {usulan.map((u) => (
                <tr key={u.code}>
                  <td style={{ fontSize: 11.5 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--td)", marginRight: 6 }}>{u.code}</span>{u.nama}
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{u.sumber}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(u.nyata)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: u.buku < 0 ? "#b91c1c" : "var(--tm)" }}>{rp(u.buku)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(u.selisih)}</td>
                </tr>
              ))}
              {usulan.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
                  Persediaan &amp; aset tetap sudah cocok dengan buku besar. ✓
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader
          num="02"
          title="ISI SALDO AWAL"
          desc={sudahAda?"Isian menampilkan saldo awal aktif secara penuh. Ubah nilai yang perlu dikoreksi dan isi alasannya.":"Baris di bawah terisi dari hitungan di atas. Tambahkan kas, piutang, dan utang sebelum sistem dipakai."}
        />
        {(!sudahAda||profile.role === "OWNER") ? <SaldoAwalForm key={`${user?.id}:${sudahAda?.id ?? "new"}`} userId={user?.id ?? ""} akun={akun} usulan={usulan} existing={sudahAda?{...sudahAda,rows:barisAktif}:undefined}/> : <div className="p2ban">Koreksi saldo awal dilakukan Super Admin.</div>}
        {history?.length ? <details style={{marginTop:14}}><summary>Riwayat saldo awal</summary>{history.map(h=><p key={h.id}>{fmtDate(h.created_at)} · {h.action === "void" ? "Pembatalan" : "Penyimpanan"}: {h.reason}</p>)}</details> : null}
      </div>
    </>
  );
}
