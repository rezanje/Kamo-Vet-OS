import type { ReactNode } from "react";
import type { DashboardBlock } from "@/lib/operation-sales-server";
import type { BarisPerbandingan, NilaiStokBlock, PerbandinganBlock } from "@/lib/perbandingan-cabang-server";
import { pertumbuhan } from "@/lib/perbandingan-cabang";
import { angka, BlockState, EmptyRow, rupiah, Section } from "./dashboard-ui";

const tanggalPendek = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
const rentang = (from: string, to: string) => from === to ? tanggalPendek(from) : `${tanggalPendek(from)} – ${tanggalPendek(to)}`;
const jumlah = (value: number | null) => value === null ? "—" : angka(value, Number.isInteger(value) ? 0 : 2);

/** Naik/turun dibanding bulan lalu. */
export function Growth({ sekarang, bulanLalu }: { sekarang: number | null; bulanLalu: number | null }) {
  const pct = pertumbuhan(sekarang, bulanLalu);
  if (pct === null) {
    const baru = (bulanLalu === null || bulanLalu === 0) && (sekarang ?? 0) > 0;
    return <span style={{ color: "var(--td)" }}>{baru ? "baru" : "—"}</span>;
  }
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return <span style={{ color: "var(--tm)" }}>= 0%</span>;
  const naik = rounded > 0;
  return (
    <span style={{ color: naik ? "#15803d" : "#b91c1c", fontWeight: 700 }}>
      {naik ? "▲" : "▼"} {angka(Math.abs(rounded), 1)}%
    </span>
  );
}

function Sel({ sekarang, bulanLalu, format, strong }: {
  sekarang: number | null;
  bulanLalu: number | null;
  format: (value: number | null) => string;
  strong?: boolean;
}) {
  return (
    <td style={{ textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap" }}>
      <div style={{ fontWeight: strong ? 800 : 700 }}>{format(sekarang)}</div>
      <div style={{ fontSize: 9.5, color: "var(--tm)" }}>bln lalu {format(bulanLalu)}</div>
      <div style={{ fontSize: 10 }}><Growth sekarang={sekarang} bulanLalu={bulanLalu} /></div>
    </td>
  );
}

function Kepala({ children }: { children: ReactNode }) {
  // Baris kepala kedua: tanpa sudut membulat bawaan .tbl (sel pertama/terakhir bukan ujung tabel).
  return <th style={{ textAlign: "right", verticalAlign: "bottom", borderRadius: 0 }}>{children}</th>;
}

function BarisCabang({ row, total }: { row: BarisPerbandingan; total?: boolean }) {
  const { sekarang: s, bulanLalu: l } = row;
  return (
    <tr style={total ? { background: "var(--sf1)" } : undefined}>
      <td style={{ fontWeight: total ? 800 : 700, verticalAlign: "top" }}>{row.branchName}</td>
      <Sel sekarang={s.petshop.rataRata} bulanLalu={l.petshop.rataRata} format={rupiah} strong={total} />
      <Sel sekarang={s.petshop.customer} bulanLalu={l.petshop.customer} format={jumlah} strong={total} />
      <Sel sekarang={s.petshop.transaksi} bulanLalu={l.petshop.transaksi} format={jumlah} strong={total} />
      <Sel sekarang={s.klinik.rataRata} bulanLalu={l.klinik.rataRata} format={rupiah} strong={total} />
      <Sel sekarang={s.klinik.customer} bulanLalu={l.klinik.customer} format={jumlah} strong={total} />
      <Sel sekarang={s.klinik.transaksi} bulanLalu={l.klinik.transaksi} format={jumlah} strong={total} />
      <Sel sekarang={s.grooming} bulanLalu={l.grooming} format={jumlah} strong={total} />
    </tr>
  );
}

export function PerbandinganCabang({ block, stockValue, nomor }: {
  block: DashboardBlock<PerbandinganBlock>;
  stockValue: DashboardBlock<NilaiStokBlock> | null;
  nomor: string;
}) {
  return (
    <Section title={`${nomor} · CABANG vs BULAN LALU`}>
      <BlockState block={block}>
        {(data) => (
          <>
            <div style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 8 }}>
              <b style={{ color: "var(--sb)" }}>{rentang(data.periode.from, data.periode.to)}</b> dibanding tanggal yang sama bulan lalu{" "}
              <b style={{ color: "var(--sb)" }}>{rentang(data.pembanding.from, data.pembanding.to)}</b>.
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 960 }}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ verticalAlign: "bottom" }}>Cabang</th>
                    <th colSpan={3} style={{ textAlign: "center", borderBottom: ".5px solid var(--bd)" }}>Petshop</th>
                    <th colSpan={3} style={{ textAlign: "center", borderBottom: ".5px solid var(--bd)" }}>Klinik</th>
                    <th rowSpan={2} style={{ textAlign: "right", verticalAlign: "bottom" }}>Grooming</th>
                  </tr>
                  <tr>
                    <Kepala>Rata-rata transaksi</Kepala><Kepala>Customer</Kepala><Kepala>Transaksi</Kepala>
                    <Kepala>Rata-rata transaksi</Kepala><Kepala>Customer</Kepala><Kepala>Transaksi</Kepala>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => <BarisCabang key={row.branchId} row={row} />)}
                  {data.rows.length === 0 && <EmptyRow columns={8} />}
                  {data.rows.length > 1 && <BarisCabang row={data.total} total />}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.5 }}>
              Petshop = struk kasir + order online; klinik = tagihan klinik. Nilai sudah dikurangi retur/refund dan tidak terpengaruh pilihan kanal di atas.
              Customer = pelanggan berbeda yang bertransaksi (transaksi tanpa nama pelanggan tidak ikut dihitung).
              Grooming = kunjungan klinik poli grooming + layanan grooming yang dijual lewat kasir.
            </div>
          </>
        )}
      </BlockState>

      {stockValue && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 8 }}>Nilai stok (HPP)</div>
          <BlockState block={stockValue}>
            {(stock) => (
              <>
                <div style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 8 }}>
                  Posisi akhir hari <b style={{ color: "var(--sb)" }}>{tanggalPendek(stock.tanggal)}</b> dibanding{" "}
                  <b style={{ color: "var(--sb)" }}>{tanggalPendek(stock.tanggalPembanding)}</b>.
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="tbl" style={{ minWidth: 520 }}>
                    <thead><tr><th>Cabang</th><th style={{ textAlign: "right" }}>Stok petshop</th><th style={{ textAlign: "right" }}>Stok klinik</th></tr></thead>
                    <tbody>
                      {[...stock.rows, ...(stock.rows.length > 1 ? [stock.total] : [])].map((row) => {
                        const total = row.branchId === "*";
                        return (
                          <tr key={row.branchId} style={total ? { background: "var(--sf1)" } : undefined}>
                            <td style={{ fontWeight: total ? 800 : 700, verticalAlign: "top" }}>{row.branchName}</td>
                            <Sel sekarang={row.sekarang.petshop} bulanLalu={row.bulanLalu.petshop} format={rupiah} strong={total} />
                            <Sel sekarang={row.sekarang.klinik} bulanLalu={row.bulanLalu.klinik} format={rupiah} strong={total} />
                          </tr>
                        );
                      })}
                      {stock.rows.length === 0 && <EmptyRow columns={3} />}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.5 }}>
                  Petshop = gudang toko + gudang online; klinik = gudang klinik. Gudang pusat (DC), expired, dan transit tidak dihitung.
                  Nilai hari ini sama dengan laporan Nilai Persediaan ({stock.metode === "moving_average" ? "HPP rata-rata" : "HPP FIFO"}); nilai tanggal lampau
                  dihitung mundur dari kartu stok, jadi bisa sedikit beda bila ada stok minus pada periode itu.
                </div>
              </>
            )}
          </BlockState>
        </div>
      )}
    </Section>
  );
}
