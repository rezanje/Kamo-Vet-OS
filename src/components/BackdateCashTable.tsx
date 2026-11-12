import Link from "next/link";

export type BackdateCashRow = {
  id: string; kind: string; doc_id: string; doc_ref: string | null; effective_date: string; doc_date: string | null; actual_date: string;
  actual_at: string; days_back: number; reason: string | null; no_jurnal: string | null; cash_amount: number | null;
  cash_account_code: string | null; cash_account_name: string | null; actor_name: string | null;
};

const KIND: Record<string, string> = {
  "payment-cancel": "Pembatalan pembayaran", "advance-cancel": "Pembatalan uang muka", "payment-replace": "Pembayaran pengganti",
  "receipt-cancel": "Pembatalan penerimaan", "invoice-cancel": "Pembatalan faktur", "receipt-replace": "Penerimaan pengganti", "invoice-replace": "Faktur pengganti",
};
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (s: string) => new Date(`${s}T00:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

/**
 * Pembatalan pembelian yang uangnya kembali ke kas/bank: tanggal PEMBUKUAN (jurnal; dipakai neraca, hutang, laporan) dan tanggal FISIK
 * (hari uang benar-benar kembali, = waktu nyata pencatatan) ditampilkan berdampingan supaya mudah dicocokkan dengan rekening koran.
 */
export function BackdateCashTable({ rows, error }: { rows: BackdateCashRow[]; error?: string | null }) {
  return (
    <div style={{ overflowX: "auto" }}>
      {error && <div role="alert" className="p2ban">{error}</div>}
      <table className="tbl" style={{ minWidth: 860 }} data-testid="backdate-cash-table">
        <thead>
          <tr>
            <th>Tanggal pembukuan</th><th>Tanggal uang fisik</th><th>Jenis</th><th>Dokumen</th><th>Rekening</th>
            <th style={{ textAlign: "right" }}>Uang masuk (+) / keluar (-)</th><th>Alasan</th><th>Pelaku</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ fontSize: 11 }}>{fmtDate(r.effective_date)}{r.days_back > 0 && <span style={{ color: "var(--tm)" }}> · mundur {r.days_back} hari</span>}</td>
              <td style={{ fontSize: 11 }}>{fmtDate(r.actual_date)}</td>
              <td style={{ fontSize: 11 }}>{KIND[r.kind] ?? r.kind}</td>
              <td style={{ fontSize: 11 }}>{r.doc_ref ?? "—"}{r.no_jurnal && <span style={{ color: "var(--tm)" }}> · {r.no_jurnal}</span>}</td>
              <td style={{ fontSize: 11 }}>{r.cash_account_name ?? r.cash_account_code ?? "—"}</td>
              <td style={{ textAlign: "right", fontSize: 11 }}>{r.cash_amount == null ? "—" : rp(Number(r.cash_amount))}</td>
              <td style={{ fontSize: 11 }}>{r.reason ?? "—"}</td>
              <td style={{ fontSize: 11 }}>{r.actor_name ?? "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada pembatalan pembelian yang mengembalikan uang.</td></tr>}
        </tbody>
      </table>
      <p style={{ fontSize: 10.5, color: "var(--tm)" }}>Tanggal pembukuan = tanggal jurnal (laporan dan hutang). Tanggal uang fisik = hari pembatalan dicatat; cocokkan dengan mutasi rekening koran pada hari itu. <Link href="/keuangan/jurnal">Lihat jurnal</Link></p>
    </div>
  );
}
