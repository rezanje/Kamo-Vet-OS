import Link from "next/link";

// ponytail: static prototype ledger. Real journals auto-post when finance
// transactions exist (double-entry per SAK).
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const ROWS: [string, string, string, string, string, number, string, string][] = [
  ["27/6", "JU-00892", "Auto: Faktur penjualan SI.01760", "110201 Piutang Dagang", "400001 Pendapatan", 185000, "b", "Auto"],
  ["27/6", "JU-00891", "Auto: HPP penjualan SI.01760", "510101 BPP", "110401 Persediaan", 87000, "b", "Auto"],
  ["27/6", "JU-00890", "Auto: Payroll Mei — Drh. Haidar", "520101 Bbn Gaji", "210301 Hutang Gaji", 5427411, "b", "Auto"],
  ["26/6", "JU-00885", "Auto: Penerimaan kas SI.01758", "111101 Kas", "110201 Piutang", 120000, "b", "Auto"],
  ["25/6", "JU-00878", "Manual: Koreksi stok opname", "650201 Selisih", "110401 Persediaan", 45000, "x", "Manual"],
  ["25/6", "JU-00877", "Auto: Penyusutan aset Jun 2026", "530101 Bbn Penyusutan", "170101 Ak. Penyusutan", 1200000, "b", "Auto"],
];

export default function JurnalPage() {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Jurnal Umum</span>
      </div>

      <div className="j-info">
        <i className="ti ti-info-circle" style={{ fontSize: 13, verticalAlign: -1, marginRight: 6 }} />
        Setiap transaksi VetOS auto-generate jurnal double-entry sesuai SAK Indonesia. Jurnal manual hanya untuk koreksi.
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="date" defaultValue="2026-06-01" className="fi" style={{ width: 130 }} />
          <span style={{ color: "var(--td)" }}>—</span>
          <input type="date" defaultValue="2026-06-27" className="fi" style={{ width: 130 }} />
        </div>
        <button className="btn-acc">+ Jurnal manual</button>
      </div>

      <table className="tbl">
        <thead>
          <tr>
            <th>Tgl</th>
            <th>No. Jurnal</th>
            <th>Keterangan</th>
            <th>Debit</th>
            <th>Kredit</th>
            <th>Jumlah</th>
            <th>Tipe</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r[1]}>
              <td style={{ fontSize: 10, color: "var(--td)" }}>{r[0]}</td>
              <td style={{ fontFamily: "monospace", fontSize: 9.5 }}>{r[1]}</td>
              <td style={{ fontSize: 10.5, maxWidth: 110 }}>{r[2]}</td>
              <td style={{ fontSize: 9.5, color: "#2563eb" }}>{r[3]}</td>
              <td style={{ fontSize: 9.5, color: "#dc2626" }}>{r[4]}</td>
              <td style={{ fontSize: 11 }}>{rp(r[5])}</td>
              <td>
                <span className={`bge ${r[6]}`}>{r[7]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
