import { createClient } from "@/lib/supabase/server";
import { getDashboard } from "@/lib/dashboard";
import { Donut, LineChart, CashFlowChart } from "@/components/Charts";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const rpJt = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return "Rp " + (n / 1e9).toFixed(2).replace(/\.?0+$/, "") + " M";
  if (a >= 1e6) return "Rp " + (n / 1e6).toFixed(1).replace(/\.0$/, "") + " jt";
  return rp(n);
};

const BEBAN_COLORS = ["#2563eb", "#d97706", "#16a34a", "#7c3aed", "#dc2626", "#94a3b8"];

export default async function Dashboard() {
  const supabase = await createClient();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const d = await getDashboard(supabase as never, today);

  const lr = d.labaRugi;
  const totalBeban = d.beban.reduce((a, b) => a + b.amount, 0);
  const tahun = today.slice(0, 4);

  return (
    <>
      <div className="pg-hd">Dashboard</div>
      <div className="pg-sub">PT Kamo Group · Semua Cabang · Tahun {tahun}</div>

      {/* KPI ringkas */}
      <div className="kgrid">
        <Kpi label="Pendapatan (tahun ini)" value={rpJt(lr.pendapatan)} tone="g" />
        <Kpi label="Laba bersih (tahun ini)" value={rpJt(lr.laba)} tone={lr.laba >= 0 ? "g" : "r"} />
        <Kpi label="Saldo Kas & Bank" value={rpJt(d.saldoKas)} tone="b" />
        <Kpi label="Piutang belum tertagih" value={rpJt(d.penjualan.belumLunas)} tone={d.penjualan.belumLunas > 0 ? "o" : "g"} />
      </div>

      {/* Baris 1: Laba/Rugi · Beban · Arus Kas */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 11, marginBottom: 13 }}>
        <div className="card" style={{ minWidth: 0 }}>
          <div className="card-hd"><i className="ti ti-chart-donut" style={{ color: "var(--acc)" }} /> Laba / Rugi tahun ini</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <Donut
              segments={[
                { value: lr.hpp, color: "#d97706" },
                { value: lr.pengeluaran, color: "#dc2626" },
                { value: Math.max(0, lr.laba), color: "#16a34a" },
              ]}
              centerLabel={lr.pendapatan > 0 ? `${Math.round((lr.laba / lr.pendapatan) * 100)}%` : "—"}
              centerSub="margin laba"
              size={112}
            />
            <div style={{ width: "100%" }}>
              <LegendRow color="#16a34a" label="Pendapatan" value={rpJt(lr.pendapatan)} />
              <LegendRow color="#d97706" label="Nilai HPP" value={rpJt(lr.hpp)} />
              <LegendRow color="#dc2626" label="Pengeluaran" value={rpJt(lr.pengeluaran)} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 8, borderTop: "2px solid #16213e" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Laba</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: lr.laba >= 0 ? "#15803d" : "#b91c1c" }}>{rp(lr.laba)}</span>
          </div>
        </div>

        <div className="card" style={{ minWidth: 0 }}>
          <div className="card-hd"><i className="ti ti-chart-pie" style={{ color: "#2563eb" }} /> Beban perusahaan</div>
          {totalBeban === 0 ? (
            <Empty text="Belum ada beban tahun ini." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <Donut segments={d.beban.map((b, i) => ({ value: b.amount, color: BEBAN_COLORS[i % BEBAN_COLORS.length] }))}
                centerLabel={rpJt(totalBeban).replace("Rp ", "")} centerSub="total beban" size={112} />
              <div style={{ width: "100%" }}>
                {d.beban.map((b, i) => <LegendRow key={b.name} color={BEBAN_COLORS[i % BEBAN_COLORS.length]} label={b.name} value={rpJt(b.amount)} />)}
              </div>
            </div>
          )}
        </div>

        <div className="card" style={{ minWidth: 0 }}>
          <div className="card-hd"><i className="ti ti-arrows-exchange" style={{ color: "#7c3aed" }} /> Arus kas (7 hari)</div>
          <CashFlowChart data={d.arusKas} />
          <div style={{ display: "flex", gap: 14, justifyContent: "center", fontSize: 10, color: "var(--tm)", marginTop: 2 }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#16a34a", borderRadius: 2, marginRight: 4 }} />Masuk</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#dc2626", borderRadius: 2, marginRight: 4 }} />Keluar</span>
          </div>
        </div>
      </div>

      {/* Baris 2: Tren penjualan · Penjualan/Pembelian */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 11, marginBottom: 13 }}>
        <div className="card">
          <div className="card-hd"><i className="ti ti-trending-up" style={{ color: "#2563eb" }} /> Tren penjualan POS (7 hari)</div>
          <LineChart
            points={d.trenPenjualan.map((t) => t.total)}
            labels={d.trenPenjualan.map((t) => { const dt = new Date(t.tanggal + "T00:00:00"); return `${dt.getDate()}/${dt.getMonth() + 1}`; })}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <SummaryCard title="Penjualan (tahun ini)" icon="ti-receipt-2" total={d.penjualan.total} lunas={d.penjualan.lunas} belum={d.penjualan.belumLunas} lunasLabel="Lunas" belumLabel="Belum lunas" />
          <SummaryCard title="Pembelian (tahun ini)" icon="ti-truck-delivery" total={d.pembelian.total} lunas={d.pembelian.lunas} belum={d.pembelian.belumLunas} lunasLabel="Terbayar" belumLabel="Belum bayar" />
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: "g" | "r" | "b" | "o" }) {
  const col = { g: "#16a34a", r: "#dc2626", b: "#2563eb", o: "#d97706" }[tone];
  return (
    <div className="kcard">
      <div className="klab">{label}</div>
      <div className="kval" style={{ color: col }}>{value}</div>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 11, borderBottom: ".5px solid var(--bd)" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--tm)" }}>{label}</span>
      <span style={{ fontWeight: 600, flexShrink: 0 }}>{value}</span>
    </div>
  );
}

function SummaryCard({ title, icon, total, lunas, belum, lunasLabel, belumLabel }: {
  title: string; icon: string; total: number; lunas: number; belum: number; lunasLabel: string; belumLabel: string;
}) {
  const pctLunas = total > 0 ? (lunas / total) * 100 : 0;
  return (
    <div className="card" style={{ flex: 1 }}>
      <div className="card-hd"><i className={`ti ${icon}`} style={{ color: "var(--acc)" }} /> {title}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{rp(total)}</div>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 8, background: "var(--bd)" }}>
        <div style={{ width: `${pctLunas}%`, background: "#16a34a" }} />
        <div style={{ width: `${100 - pctLunas}%`, background: "#f59e0b" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span style={{ color: "#15803d" }}>{lunasLabel}: {rp(lunas)}</span>
        <span style={{ color: "#b45309" }}>{belumLabel}: {rp(belum)}</span>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 11, color: "var(--td)", padding: "24px 0", textAlign: "center" }}>{text}</div>;
}
