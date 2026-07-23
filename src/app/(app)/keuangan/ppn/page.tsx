import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

type LineRow = {
  debit: number;
  credit: number;
  coa_accounts: { code: string } | null;
  journal_entries: { tanggal: string } | null;
};

// Rekap PPN per bulan: Keluaran (2201) vs Masukan (1105) → netto kurang/lebih bayar.
export default async function RekapPpnPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("journal_lines")
    .select("debit, credit, coa_accounts!inner(code), journal_entries!inner(tanggal)")
    .in("coa_accounts.code", ["2201", "1105"]);

  const perBulan = new Map<string, { keluaran: number; masukan: number }>();
  for (const raw of (data ?? []) as unknown as LineRow[]) {
    const code = raw.coa_accounts?.code;
    const bulan = raw.journal_entries?.tanggal?.slice(0, 7);
    if (!code || !bulan) continue;
    const cur = perBulan.get(bulan) ?? { keluaran: 0, masukan: 0 };
    if (code === "2201") cur.keluaran += Number(raw.credit) - Number(raw.debit);
    else cur.masukan += Number(raw.debit) - Number(raw.credit);
    perBulan.set(bulan, cur);
  }
  const rows = [...perBulan.entries()]
    .map(([bulan, v]) => ({ bulan, ...v, netto: v.keluaran - v.masukan }))
    .sort((a, b) => b.bulan.localeCompare(a.bulan));

  const totKeluaran = rows.reduce((a, r) => a + r.keluaran, 0);
  const totMasukan = rows.reduce((a, r) => a + r.masukan, 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Rekap PPN</span>
      </div>

      <div className="crm-sec">
        <SecHeader
          num="01"
          title="REKAP PPN PER BULAN"
          desc="PPN Keluaran (penjualan) dikurangi PPN Masukan (pembelian) = netto disetor. Bahan lapor SPT Masa. Kelola status PKP di Pengaturan → Pajak."
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Bulan</th>
                <th style={{ textAlign: "right" }}>PPN Keluaran</th>
                <th style={{ textAlign: "right" }}>PPN Masukan</th>
                <th style={{ textAlign: "right" }}>Netto (Kurang/Lebih Bayar)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bulan}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.bulan}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(r.keluaran)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(r.masukan)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: r.netto >= 0 ? "#b91c1c" : "#15803d" }}>
                    {rp(r.netto)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Belum ada transaksi ber-PPN. (Mode PKP nonaktif → PPN tidak dipungut.)
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td style={{ fontSize: 11.5, fontWeight: 800 }}>TOTAL</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 800 }}>{rp(totKeluaran)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 800 }}>{rp(totMasukan)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 800 }}>{rp(totKeluaran - totMasukan)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}
