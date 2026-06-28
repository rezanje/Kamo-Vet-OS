import Link from "next/link";

// ponytail: static prototype roster. Wires to an employees table when HRIS lands.
const ROWS: [string, string, string, string, string, string, string][] = [
  ["K-2025055023", "Aceng Purnama A.", "Admin Klinik", "VET CMGG", "Kontrak", "✓", "g"],
  ["K-2024018901", "Drh. Haidar Rafi A.", "Dokter Hewan", "Multi-cabang", "Tetap", "✓", "g"],
  ["K-2024032210", "Drh. Handitya", "Dokter Hewan", "VET TKI", "Tetap", "✓", "g"],
  ["K-2025041105", "Siti Ambar R.", "Kasir", "BTKM", "Tetap", "✓", "g"],
  ["K-2026001032", "Bekti Sri U.", "Groomer", "VET GRLG", "Kontrak", "—", "x"],
];

export default function KaryawanPage() {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/hris" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Data Karyawan</span>
      </div>

      <div className="p2ban">
        <i className="ti ti-scan-eye" style={{ fontSize: 18, color: "var(--acc)" }} />
        <div>
          <div style={{ fontWeight: 500, color: "#92400e", fontSize: 11.5 }}>
            Verifikasi Wajah — Fase 2
          </div>
          <div style={{ fontSize: 10.5, color: "#b45309", marginTop: 1 }}>
            Absensi v1 menggunakan geolokasi browser. Face verification aktif di fase berikutnya setelah v1 go-live.
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", gap: 7 }}>
          <input className="fi" placeholder="Cari karyawan..." style={{ width: 160 }} />
          <select className="fi" style={{ width: 130 }}>
            <option>Semua cabang</option>
            <option>VET CMGG</option>
            <option>VET TKI</option>
          </select>
        </div>
        <button className="btn-acc">+ Tambah karyawan</button>
      </div>

      <table className="tbl">
        <thead>
          <tr>
            <th>ID</th>
            <th>Nama</th>
            <th>Jabatan</th>
            <th>Cabang</th>
            <th>Status</th>
            <th>BPJS</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r[0]}>
              <td style={{ fontFamily: "monospace", fontSize: 10 }}>{r[0]}</td>
              <td style={{ fontWeight: 500 }}>{r[1]}</td>
              <td style={{ color: "var(--tm)" }}>{r[2]}</td>
              <td>{r[3]}</td>
              <td>
                <span className={`bge ${r[6]}`}>{r[4]}</span>
              </td>
              <td
                style={{
                  textAlign: "center",
                  color: r[5] === "✓" ? "#16a34a" : "var(--td)",
                }}
              >
                {r[5]}
              </td>
              <td>
                <button className="back-btn">Detail</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
