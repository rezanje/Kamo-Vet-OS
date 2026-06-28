// ponytail: KPIs + recent transactions are mockup figures from the approved
// prototype. Real aggregates wire in once POS / finance tables exist (Fase 2+).
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const BARS = [32, 55, 40, 62, 48, 75, 60, 43, 70, 52, 78, 42];

const UPCOMING = [
  "SI.01752 · Piutang JT — Citra/Aril",
  "SI.01756 · Piutang JT — Tony/Jono",
  "SI.01758 · Piutang JT — Ayya",
  "RI.00041 · Rawat Inap — Luna (VET CMGG)",
];

const RECENT: [string, string, string, string, number, string, string][] = [
  ["SI.01760", "POS", "Dian Pratiwi", "CMGG", 185000, "g", "Lunas"],
  ["SI.01759", "Klinik", "Budi / Max", "VET TKI", 450000, "o", "Belum lunas"],
  ["RI.00041", "Rawat Inap", "Sari / Luna", "VET CMGG", 1200000, "b", "Aktif"],
  ["SI.01758", "Grooming", "Ayya / Momo", "BTKM", 120000, "g", "Lunas"],
  ["PI.00892", "Pembelian", "PT Medion", "DC LOJI", 3200000, "o", "Belum bayar"],
];

export default function Dashboard() {
  return (
    <>
      <div className="pg-hd">Dashboard</div>
      <div className="pg-sub">PT Kamo Group · Semua Cabang · Jun 2026</div>

      <div className="kgrid">
        <div className="kcard">
          <div className="klab">Pendapatan bulan ini</div>
          <div className="kval">Rp 1,47M</div>
          <div className="kdelta" style={{ color: "#16a34a" }}>
            <i className="ti ti-trending-up" style={{ fontSize: 11 }} /> +4% vs bln lalu
          </div>
        </div>
        <div className="kcard">
          <div className="klab">Laba bersih (YTD)</div>
          <div className="kval">Rp 847jt</div>
          <div className="kdelta" style={{ color: "#16a34a" }}>
            <i className="ti ti-trending-up" style={{ fontSize: 11 }} /> +3%
          </div>
        </div>
        <div className="kcard">
          <div className="klab">Pembelian</div>
          <div className="kval">Rp 1,05M</div>
          <div className="kdelta" style={{ color: "#dc2626" }}>
            <i className="ti ti-trending-up" style={{ fontSize: 11 }} /> +22%
          </div>
        </div>
        <div className="kcard">
          <div className="klab">Pasien hari ini</div>
          <div className="kval">47</div>
          <div className="kdelta" style={{ color: "var(--tm)" }}>12 cabang aktif</div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gap: 11,
          marginBottom: 13,
        }}
      >
        <div className="card">
          <div className="card-hd">
            <i className="ti ti-chart-bar" style={{ color: "var(--acc)" }} />
            Tren penjualan (12 minggu)
          </div>
          <div className="bars">
            {BARS.map((v, i) => (
              <div
                key={i}
                className="bar"
                style={{
                  height: `${v}%`,
                  background: i === BARS.length - 1 ? "#d97757" : "#c0dd97",
                }}
                title={rp(v * 18500)}
              />
            ))}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 9.5,
              color: "var(--td)",
              marginTop: 4,
            }}
          >
            <span>Apr</span>
            <span>Mei</span>
            <span>Jun</span>
          </div>
        </div>

        <div className="card">
          <div className="card-hd">
            <i className="ti ti-calendar-event" style={{ color: "#2563eb" }} />
            Kegiatan mendatang
          </div>
          <div style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 6 }}>
            Hari ini · 27 Jun 2026
          </div>
          {UPCOMING.map((x) => (
            <div
              key={x}
              style={{
                fontSize: 10.5,
                padding: "4px 0",
                borderBottom: ".5px solid var(--bd)",
                display: "flex",
                gap: 7,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "#16a34a",
                  flexShrink: 0,
                  display: "inline-block",
                }}
              />
              {x}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <i className="ti ti-list" style={{ color: "var(--tm)" }} />
          Transaksi terbaru
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>No. Faktur</th>
              <th>Tipe</th>
              <th>Pelanggan</th>
              <th>Cabang</th>
              <th>Jumlah</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {RECENT.map((r) => (
              <tr key={r[0]}>
                <td style={{ fontFamily: "monospace", fontSize: 10 }}>{r[0]}</td>
                <td>{r[1]}</td>
                <td>{r[2]}</td>
                <td style={{ fontSize: 10.5 }}>{r[3]}</td>
                <td>{rp(r[4])}</td>
                <td>
                  <span className={`bge ${r[5]}`}>{r[6]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
