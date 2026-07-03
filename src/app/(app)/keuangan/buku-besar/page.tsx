import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { getAccountBalances, getAccountLedger } from "@/lib/ledger";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (s: string) => (s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default async function BukuBesarPage({ searchParams }: { searchParams: Promise<{ akun?: string }> }) {
  const { akun } = await searchParams;
  const supabase = await createClient();
  const balances = await getAccountBalances(supabase as never);

  const totalDebit = balances.reduce((a, b) => a + b.debit, 0);
  const totalKredit = balances.reduce((a, b) => a + b.credit, 0);
  const seimbang = Math.round(totalDebit) === Math.round(totalKredit);

  const selected = akun ? balances.find((b) => b.code === akun) : null;
  const ledger = selected ? await getAccountLedger(supabase as never, selected.code) : [];

  // saldo berjalan untuk akun terpilih
  const ledgerRows = ledger.reduce<(typeof ledger[number] & { saldo: number })[]>((acc, l) => {
    const prev = acc.length ? acc[acc.length - 1].saldo : 0;
    const delta = selected!.normal === "D" ? l.debit - l.credit : l.credit - l.debit;
    acc.push({ ...l, saldo: prev + delta });
    return acc;
  }, []);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Buku Besar</span>
      </div>

      <div className="crm-sec">
        <SecHeader num="01" title="RINGKASAN BUKU BESAR" desc="Saldo seluruh akun (neraca saldo / trial balance)." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr><th>Kode</th><th>Nama Akun</th><th>Tipe</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Kredit</th><th style={{ textAlign: "right" }}>Saldo</th><th /></tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.code} style={{ background: selected?.code === b.code ? "rgba(217,119,87,.06)" : undefined }}>
                  <td style={{ fontFamily: "monospace", fontSize: 11, color: "var(--tm)" }}>{b.code}</td>
                  <td style={{ fontSize: 12 }}>{b.name}</td>
                  <td style={{ fontSize: 10, color: "var(--tm)" }}>{b.type}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{b.debit ? rp(b.debit) : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{b.credit ? rp(b.credit) : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 500 }}>{rp(b.saldo)}</td>
                  <td><Link href={`/keuangan/buku-besar?akun=${b.code}`} className="back-btn" style={{ fontSize: 11 }} title="Lihat mutasi"><i className="ti ti-eye" /></Link></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid #16213e" }}>
                <td colSpan={3} style={{ fontWeight: 700, fontSize: 11, paddingTop: 8 }}>TOTAL</td>
                <td style={{ textAlign: "right", fontWeight: 700, fontSize: 11, paddingTop: 8 }}>{rp(totalDebit)}</td>
                <td style={{ textAlign: "right", fontWeight: 700, fontSize: 11, paddingTop: 8 }}>{rp(totalKredit)}</td>
                <td colSpan={2} style={{ textAlign: "right", paddingTop: 8 }}>
                  <span className={`bge ${seimbang ? "g" : "r"}`}>{seimbang ? "Seimbang" : "Timpang!"}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {selected && (
        <div className="crm-sec">
          <SecHeader num="02" title={`MUTASI — ${selected.code} ${selected.name}`} desc="Rincian transaksi & saldo berjalan."
            action={<Link href="/keuangan/buku-besar" className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>Tutup</Link>} />
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 560 }}>
              <thead>
                <tr><th>Tanggal</th><th>No. Jurnal</th><th>Keterangan</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Kredit</th><th style={{ textAlign: "right" }}>Saldo</th></tr>
              </thead>
              <tbody>
                {ledgerRows.map((l, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(l.tanggal)}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 10.5 }}>{l.no_jurnal}</td>
                    <td style={{ fontSize: 11.5 }}>{l.deskripsi}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{l.debit ? rp(l.debit) : "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{l.credit ? rp(l.credit) : "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 500 }}>{rp(l.saldo)}</td>
                  </tr>
                ))}
                {ledgerRows.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "14px 0", fontSize: 11 }}>Belum ada mutasi.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
