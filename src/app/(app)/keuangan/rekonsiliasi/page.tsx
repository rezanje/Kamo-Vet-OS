import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { getAccountBalances } from "@/lib/ledger";
import { RekonForm } from "./RekonForm";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (s: string) => new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export default async function RekonsiliasiPage({ searchParams }: { searchParams: Promise<{ success?: string }> }) {
  const { success } = await searchParams;
  const supabase = await createClient();

  const balances = await getAccountBalances(supabase as never);
  const saldoBuku = balances.find((b) => b.code === "1102")?.saldo ?? 0;

  const { data: history } = await supabase
    .from("bank_reconciliations")
    .select("id, tanggal, saldo_buku, saldo_bank, biaya_adm, bunga, selisih, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Rekonsiliasi Bank</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Rekonsiliasi tersimpan. Biaya admin / bunga sudah dijurnal ke buku.
        </div>
      )}

      <div className="crm-sec">
        <SecHeader num="01" title="REKONSILIASI BANK BCA" desc="Cocokkan saldo buku (akun 1102) dengan rekening koran bank." />
        <RekonForm saldoBuku={saldoBuku} />
      </div>

      <div className="crm-sec">
        <SecHeader num="02" title="RIWAYAT REKONSILIASI" desc="Rekonsiliasi yang sudah diproses." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr><th>Tanggal</th><th style={{ textAlign: "right" }}>Saldo Buku</th><th style={{ textAlign: "right" }}>Saldo Bank</th><th style={{ textAlign: "right" }}>Biaya Adm</th><th style={{ textAlign: "right" }}>Bunga</th><th style={{ textAlign: "right" }}>Selisih</th></tr>
            </thead>
            <tbody>
              {(history ?? []).map((h) => (
                <tr key={h.id}>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(h.tanggal)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(h.saldo_buku)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(h.saldo_bank)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(h.biaya_adm)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(h.bunga)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>
                    <span className={`bge ${Math.round(Number(h.selisih)) === 0 ? "g" : "r"}`}>{rp(Number(h.selisih))}</span>
                  </td>
                </tr>
              ))}
              {(history ?? []).length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada rekonsiliasi.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
