import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { getAccountBalances } from "@/lib/ledger";
import { hariIniWIB } from "@/lib/tanggal";
import { RekonForm, type RekeningRekon } from "./RekonForm";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (s: string) => new Date(s).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

export default async function RekonsiliasiPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const [balances, { data: rekData }, { data: history }] = await Promise.all([
    getAccountBalances(supabase as never),
    supabase.from("cash_accounts").select("id, nama, coa_code").eq("jenis", "Bank").eq("is_active", true).order("nama"),
    supabase
      .from("bank_reconciliations")
      .select("id, tanggal, saldo_buku, saldo_bank, biaya_adm, bunga, selisih, created_at, cash_accounts(nama)")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const saldoPerKode = new Map(balances.map((b) => [b.code, b.saldo]));
  const rekening: RekeningRekon[] = ((rekData ?? []) as { id: string; nama: string; coa_code: string }[])
    .map((r) => ({ ...r, saldo: saldoPerKode.get(r.coa_code) ?? 0 }));

  type Riwayat = {
    id: string; tanggal: string; saldo_buku: number; saldo_bank: number;
    biaya_adm: number; bunga: number; selisih: number;
    cash_accounts: Rel<{ nama: string }>;
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/kas-bank" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Rekonsiliasi Bank</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Rekonsiliasi tersimpan. Biaya admin / bunga sudah dijurnal ke buku.
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-triangle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader num="01" title="REKONSILIASI BANK" desc="Pilih rekening, lalu cocokkan saldo buku dengan rekening korannya." />
        <RekonForm rekening={rekening} hariIni={hariIniWIB()} />
      </div>

      <div className="crm-sec">
        <SecHeader num="02" title="RIWAYAT REKONSILIASI" desc="Rekonsiliasi yang sudah diproses." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr><th>Tanggal</th><th>Rekening</th><th style={{ textAlign: "right" }}>Saldo Buku</th><th style={{ textAlign: "right" }}>Saldo Bank</th><th style={{ textAlign: "right" }}>Biaya Adm</th><th style={{ textAlign: "right" }}>Bunga</th><th style={{ textAlign: "right" }}>Selisih</th></tr>
            </thead>
            <tbody>
              {((history ?? []) as unknown as Riwayat[]).map((h) => (
                <tr key={h.id}>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(h.tanggal)}</td>
                  <td style={{ fontSize: 11 }}>{one(h.cash_accounts)?.nama ?? "Bank BCA"}</td>
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
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada rekonsiliasi.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
