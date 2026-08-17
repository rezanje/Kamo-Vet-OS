import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDashboard } from "@/lib/dashboard";
import { Donut, LineChart, CashFlowChart } from "@/components/Charts";
import { bacaSudut, LABEL_SUDUT, SUDUT, type Sudut } from "@/lib/dashboard-peran";
import { hariIniWIB } from "@/lib/tanggal";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const rpJt = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return "Rp " + (n / 1e9).toFixed(2).replace(/\.?0+$/, "") + " M";
  if (a >= 1e6) return "Rp " + (n / 1e6).toFixed(1).replace(/\.0$/, "") + " jt";
  return rp(n);
};

const BEBAN_COLORS = ["#2563eb", "#d97706", "#16a34a", "#7c3aed", "#dc2626", "#94a3b8"];

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ sudut?: string }>;
}) {
  const { sudut: sudutParam } = await searchParams;
  const supabase = await createClient();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // Sudut pandang menyesuaikan peran (meeting 14 Agustus): orang operasional tidak
  // butuh laba-rugi tahunan, dan orang marketing butuh promo — bukan arus kas.
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  const sudut = bacaSudut(sudutParam, profile?.role ?? null);

  if (sudut !== "keuangan") {
    return <DashboardLain sudut={sudut} />;
  }

  const d = await getDashboard(supabase as never, today);

  const lr = d.labaRugi;
  const totalBeban = d.beban.reduce((a, b) => a + b.amount, 0);
  const tahun = today.slice(0, 4);

  return (
    <>
      <div className="pg-hd">Dashboard</div>
      <div className="pg-sub">PT Kamo Group · Semua Cabang · Tahun {tahun}</div>
      <PilihSudut aktif={sudut} />

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
          <div className="card-hd"><i className="ti ti-trending-up" style={{ color: "#2563eb" }} /> Tren penjualan POS + Online + Reseller (7 hari)</div>
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

/** Tombol pindah sudut pandang — sama di semua tampilan. */
function PilihSudut({ aktif }: { aktif: Sudut }) {
  return (
    <div style={{ display: "flex", gap: 6, margin: "10px 0 14px", flexWrap: "wrap" }}>
      {SUDUT.map((s) => (
        <Link key={s} href={`/?sudut=${s}`} className="back-btn" style={{
          padding: "5px 12px", borderRadius: 7, textDecoration: "none",
          border: ".5px solid var(--bd)",
          background: aktif === s ? "#2563eb" : "#fff",
          color: aktif === s ? "#fff" : "var(--tm)",
        }}>
          {LABEL_SUDUT[s]}
        </Link>
      ))}
    </div>
  );
}

/**
 * Tampilan operasional & marketing.
 *
 * Angkanya sengaja HARI INI / BULAN INI, bukan setahun: yang dipakai orang
 * lapangan adalah "hari ini sudah berapa", bukan akumulasi tahunan.
 */
async function DashboardLain({ sudut }: { sudut: Sudut }) {
  const supabase = await createClient();
  const hariIni = hariIniWIB();
  const mulai = `${hariIni}T00:00:00+07:00`;
  const akhir = `${hariIni}T23:59:59+07:00`;
  const awalBulan = `${hariIni.slice(0, 8)}01`;

  if (sudut === "operasional") {
    const [
      { data: visits }, { count: menunggu }, { data: sales }, { data: stok },
    ] = await Promise.all([
      supabase.from("visits").select("poli").gte("created_at", mulai).lte("created_at", akhir),
      supabase.from("visits").select("*", { count: "exact", head: true })
        .eq("status", "Menunggu").gte("created_at", mulai).lte("created_at", akhir),
      supabase.from("sales").select("total").gte("created_at", mulai).lte("created_at", akhir),
      supabase.from("stock").select("qty, items!inner(name, min_stock)").gt("items.min_stock", 0),
    ]);

    const kunjungan = (visits ?? []) as { poli: string | null }[];
    const grooming = kunjungan.filter((v) => (v.poli ?? "").toLowerCase().includes("grooming")).length;
    const struk = (sales ?? []) as { total: number }[];
    const omzet = struk.reduce((a, s) => a + Number(s.total), 0);
    type StokRow = { qty: number; items: { name: string; min_stock: number } | { name: string; min_stock: number }[] | null };
    const menipis = ((stok ?? []) as unknown as StokRow[]).filter((r) => {
      const it = Array.isArray(r.items) ? r.items[0] : r.items;
      return it && Number(r.qty) <= Number(it.min_stock);
    });

    return (
      <>
        <div className="pg-hd">Dashboard</div>
        <div className="pg-sub">Operasional hari ini · {hariIni}</div>
        <PilihSudut aktif={sudut} />

        <div className="kgrid">
          <Kpi label="Kunjungan klinik hari ini" value={`${kunjungan.length}`} tone="b" />
          <Kpi label="Grooming hari ini" value={`${grooming}`} tone="g" />
          <Kpi label="Sedang menunggu antrian" value={`${menunggu ?? 0}`} tone={(menunggu ?? 0) > 0 ? "o" : "g"} />
          <Kpi label="Transaksi kasir hari ini" value={`${struk.length}`} tone="b" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11, marginBottom: 13 }}>
          <div className="card">
            <div className="card-hd"><i className="ti ti-cash-register" style={{ color: "var(--acc)" }} /> Omzet kasir hari ini</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{rp(omzet)}</div>
            <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 4 }}>
              Rata-rata {struk.length ? rp(omzet / struk.length) : rp(0)} per struk.
            </div>
          </div>
          <div className="card">
            <div className="card-hd"><i className="ti ti-alert-triangle" style={{ color: "#d97706" }} /> Stok menipis</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: menipis.length ? "#b45309" : "#15803d" }}>{menipis.length}</div>
            <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 4 }}>
              Barang yang stoknya sudah menyentuh batas minimum.{" "}
              <Link href="/pos/stok-minimum" style={{ color: "#2563eb" }}>Lihat daftarnya</Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Marketing
  const [{ count: promo }, { count: voucher }, { count: pelangganBaru }, { data: poin }, { data: laku }] =
    await Promise.all([
      supabase.from("promos").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("vouchers").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("customers").select("*", { count: "exact", head: true }).gte("created_at", `${awalBulan}T00:00:00+07:00`),
      supabase.from("customers").select("points").gt("points", 0),
      supabase.from("sale_items").select("nama, qty, sales!inner(created_at)")
        .gte("sales.created_at", `${awalBulan}T00:00:00+07:00`),
    ]);

  const poinBeredar = ((poin ?? []) as { points: number }[]).reduce((a, c) => a + Number(c.points), 0);
  const perProduk = new Map<string, number>();
  for (const r of (laku ?? []) as unknown as { nama: string; qty: number }[]) {
    perProduk.set(r.nama, (perProduk.get(r.nama) ?? 0) + Number(r.qty));
  }
  const teratas = [...perProduk.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <>
      <div className="pg-hd">Dashboard</div>
      <div className="pg-sub">Marketing · bulan berjalan</div>
      <PilihSudut aktif={sudut} />

      <div className="kgrid">
        <Kpi label="Promo aktif" value={`${promo ?? 0}`} tone="g" />
        <Kpi label="Voucher aktif" value={`${voucher ?? 0}`} tone="b" />
        <Kpi label="Pelanggan baru bulan ini" value={`${pelangganBaru ?? 0}`} tone="g" />
        <Kpi label="Poin beredar" value={poinBeredar.toLocaleString("id-ID")} tone="o" />
      </div>

      <div className="card">
        <div className="card-hd"><i className="ti ti-flame" style={{ color: "var(--acc)" }} /> Produk terlaris bulan ini</div>
        {teratas.length === 0 ? (
          <Empty text="Belum ada penjualan bulan ini." />
        ) : (
          teratas.map(([nama, qty]) => (
            <LegendRow key={nama} color="#2563eb" label={nama} value={`${qty.toLocaleString("id-ID")} terjual`} />
          ))
        )}
      </div>
    </>
  );
}
