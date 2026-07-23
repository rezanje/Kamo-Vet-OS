import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { getAccountBalances } from "@/lib/ledger";
import { PeriodFilter } from "../PeriodFilter";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Neraca Saldo (trial balance) — saldo tiap akun di kolom sisi normalnya; total D = total K.
export default async function NeracaSaldoPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; cabang?: string }>;
}) {
  const { dari, sampai, cabang } = await searchParams;
  const supabase = await createClient();

  const [balances, { data: branches }] = await Promise.all([
    getAccountBalances(supabase as never, { from: dari || undefined, to: sampai || undefined, branchId: cabang || undefined }),
    supabase.from("branches").select("id, name").order("name"),
  ]);

  const rows = balances
    .filter((b) => b.saldo !== 0)
    .map((b) => {
      // saldo dihitung menurut sisi normal; negatif berarti saldo di sisi lawan.
      const debit = b.normal === "D" ? Math.max(0, b.saldo) : Math.max(0, -b.saldo);
      const kredit = b.normal === "K" ? Math.max(0, b.saldo) : Math.max(0, -b.saldo);
      return { code: b.code, name: b.name, type: b.type, debit, kredit };
    });

  const totalD = rows.reduce((a, r) => a + r.debit, 0);
  const totalK = rows.reduce((a, r) => a + r.kredit, 0);
  const seimbang = Math.round(totalD) === Math.round(totalK);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Neraca Saldo</span>
        <span className={`bge ${seimbang ? "g" : "r"}`}>{seimbang ? "Seimbang" : "TIDAK SEIMBANG"}</span>
      </div>

      <div className="crm-sec">
        <SecHeader
          num="01"
          title="NERACA SALDO (TRIAL BALANCE)"
          desc="Saldo seluruh akun pada sisi normalnya — pembuktian buku besar seimbang."
        />
        <PeriodFilter basePath="/keuangan/neraca-saldo" dari={dari} sampai={sampai} cabang={cabang} branches={branches ?? []} />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama Akun</th>
                <th>Tipe</th>
                <th style={{ textAlign: "right" }}>Debit</th>
                <th style={{ textAlign: "right" }}>Kredit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td style={{ fontSize: 11, fontFamily: "var(--mono, monospace)" }}>{r.code}</td>
                  <td style={{ fontSize: 11.5 }}>{r.name}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.type}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{r.debit ? rp(r.debit) : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{r.kredit ? rp(r.kredit) : "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Belum ada saldo pada periode ini.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ fontSize: 11.5, fontWeight: 800 }}>TOTAL</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 800 }}>{rp(totalD)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 800 }}>{rp(totalK)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}
