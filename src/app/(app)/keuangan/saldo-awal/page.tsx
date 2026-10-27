import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { bacaSaldoAwal } from "./actions";
import { SaldoAwalForm } from "./SaldoAwalForm";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (s: string) => (s ? new Date(s + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" }) : "—");

export default async function SaldoAwalPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const supabase = await createClient();
  const {data:{user}} = await supabase.auth.getUser();
  const [{ usulan, sudahAda, akun }, { data: batchPerFaktur }] = await Promise.all([
    bacaSaldoAwal(supabase),
    supabase.from("opening_invoice_batches").select("ap_total, ar_total"),
  ]);
  // M05: hutang/piutang usaha yang sudah diimpor per faktur tidak boleh diisi lagi sebagai satu total
  // (database juga menolaknya). Akunnya disembunyikan dari pilihan supaya tidak tercatat ganda.
  const hutangPerFaktur = (batchPerFaktur ?? []).some((b) => Number(b.ap_total) > 0);
  const piutangPerFaktur = (batchPerFaktur ?? []).some((b) => Number(b.ar_total) > 0);
  const akunForm = akun.filter((a) => !(a.code === "2101" && hutangPerFaktur) && !(a.code === "1201" && piutangPerFaktur));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Saldo Awal</span>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> {success}</div>}

      {sudahAda && (
        <div className="p2ban" style={{ background: "#eff6ff", border: ".5px solid #93c5fd", color: "#1d4ed8", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span>
            <i className="ti ti-info-circle" /> Saldo awal sudah tersimpan: {sudahAda.no_jurnal} per {fmtDate(sudahAda.tanggal)}.
            Riwayat tetap tersimpan. Koreksi saldo pembuka kas/bank tersedia melalui rekening terkait.
          </span>
          <Link href="/kas-bank/rekening" className="back-btn">Buka rekening</Link>
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
          desc="Baris di bawah sudah terisi dari hitungan di atas. Tambahkan sendiri kas, piutang, dan utang yang sudah ada sebelum sistem dipakai."
        />
        <div className="p2ban" style={{ background: hutangPerFaktur || piutangPerFaktur ? "#fffbeb" : "#eff6ff", border: ".5px solid #93c5fd", color: "#1e3a8a", fontSize: 11.5 }}>
          <i className="ti ti-info-circle" /> Hutang Usaha (2101) dan Piutang Usaha (1201) dari Accurate diisi <strong>per faktur</strong> di{" "}
          <Link href="/keuangan/saldo-awal-faktur">Saldo Awal per Faktur</Link>, supaya pembayaran nanti bisa dialokasikan ke faktur lama.
          {hutangPerFaktur || piutangPerFaktur
            ? ` Sudah diimpor per faktur: ${[hutangPerFaktur && "hutang (2101)", piutangPerFaktur && "piutang (1201)"].filter(Boolean).join(" dan ")} — akun itu tidak bisa diisi lagi di sini agar tidak tercatat ganda.`
            : " Jangan isi kedua akun itu di sini kalau akan memakai impor per faktur; impor akan ditolak supaya tidak tercatat ganda."}
        </div>
        {!sudahAda && <SaldoAwalForm key={user?.id} userId={user?.id ?? ""} akun={akunForm} usulan={usulan} />}
        {sudahAda && <p>Saldo awal sudah tercatat. Buka rekening kas/bank untuk preview dan koreksi saldo pembukanya.</p>}
      </div>
    </>
  );
}
