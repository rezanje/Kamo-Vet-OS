import Link from "next/link";
import type { DashboardData } from "@/lib/operation-sales-server";
import type { AlertEvaluation } from "@/lib/operational-alerts";
import type { DashboardBlock } from "@/lib/operation-sales-server";
import { OperationalAlertPanel } from "./OperationalAlertPanel";
import {
  angka,
  BlockState,
  detailHref,
  EmptyRow,
  KpiCard,
  KpiGrid,
  persen,
  rupiah,
  Section,
} from "./dashboard-ui";

const channelLabel: Record<string, string> = {
  all: "Semua kanal",
  pos: "POS",
  online: "Online",
  reseller: "Reseller",
  klinik: "Klinik",
};

export function OperationSalesDashboard({ data, alerts, showAlertDiagnostics }: {
  data: DashboardData;
  alerts: DashboardBlock<AlertEvaluation>;
  showAlertDiagnostics: boolean;
}) {
  const branchName = data.scope.branches.length === 1 ? data.scope.branches[0].name : undefined;
  const detailFilter = { from: data.filter.from, to: data.filter.to, branchName };
  const branchLink = (branchId: string) => {
    const branch = data.scope.branches.find((row) => row.id === branchId);
    return detailHref("/laporan/penjualan-rinci", { ...detailFilter, branchName: branch?.name });
  };

  return (
    <>
      <OperationalAlertPanel block={alerts} filter={{ from: data.filter.from, to: data.filter.to }} showDiagnostics={showAlertDiagnostics} />
      <div className="crm-sec" style={{ marginBottom: 12, background: "#eff6ff", borderColor: "#bfdbfe" }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#1e3a8a" }}>Cockpit Operation & Sales</div>
        <div style={{ fontSize: 10.5, color: "#1d4ed8", marginTop: 3 }}>
          {data.filter.from} sampai {data.filter.to} · {channelLabel[data.filter.channel]} · Angka mengikuti cabang yang boleh lo akses.
        </div>
      </div>

      <BlockState block={data.sales}>
        {(sales) => (
          <Section title="01 · SALES">
            <KpiGrid>
              <KpiCard label="Penjualan neto" value={rupiah(sales.metrics.sales)} href={detailHref("/laporan/penjualan-rinci", detailFilter)} tone="#15803d" />
              <KpiCard label="Transaksi" value={`${sales.metrics.transactions}x`} href={detailHref("/laporan/penjualan-rinci", detailFilter)} />
              <KpiCard label="ATV" value={rupiah(sales.metrics.atv)} href={detailHref("/laporan/penjualan-rinci", detailFilter)} />
              <KpiCard label="UPT" value={angka(sales.metrics.upt)} href={detailHref("/laporan/penjualan-rinci", detailFilter)} />
              <KpiCard label="Margin kotor" value={rupiah(sales.metrics.grossMargin)} tone="#15803d" />
              <KpiCard label="Pencapaian target" value={persen(sales.target ? (sales.metrics.sales / sales.target) * 100 : null)} note={sales.target ? `Target ${rupiah(sales.target)}` : "Target belum diisi"} />
            </KpiGrid>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 10.5, color: "var(--tm)" }}>
              <span>Produk <b style={{ color: "var(--sb)" }}>{rupiah(sales.split.product)}</b></span>
              <span>Jasa/Grooming <b style={{ color: "var(--sb)" }}>{rupiah(sales.split.service)}</b></span>
              <span>Klinik <b style={{ color: "var(--sb)" }}>{rupiah(sales.split.clinic)}</b></span>
            </div>
          </Section>
        )}
      </BlockState>

      <BlockState block={data.branch}>
        {(branches) => (
          <Section title="02 · BRANCH PERFORMANCE">
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 880 }}>
                <thead><tr><th>#</th><th>Cabang</th><th style={{ textAlign: "right" }}>Sales</th><th style={{ textAlign: "right" }}>Target</th><th style={{ textAlign: "right" }}>Transaksi</th><th style={{ textAlign: "right" }}>ATV</th><th style={{ textAlign: "right" }}>Margin</th><th style={{ textAlign: "right" }}>Pelanggan unik</th></tr></thead>
                <tbody>
                  {branches.map((branch, index) => (
                    <tr key={branch.branchId}>
                      <td>{index + 1}</td>
                      <td><Link href={branchLink(branch.branchId)} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 700 }}>{branch.branchName}</Link></td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{rupiah(branch.sales)}</td>
                      <td style={{ textAlign: "right", color: branch.achievement === null ? "var(--td)" : "var(--sb)" }}>{branch.achievement === null ? "Target belum diisi" : persen(branch.achievement)}</td>
                      <td style={{ textAlign: "right" }}>{branch.transactions}x</td>
                      <td style={{ textAlign: "right" }}>{rupiah(branch.atv)}</td>
                      <td style={{ textAlign: "right" }}>{rupiah(branch.grossMargin)}</td>
                      <td style={{ textAlign: "right" }}>{branch.uniqueCustomers}</td>
                    </tr>
                  ))}
                  {branches.length === 0 && <EmptyRow columns={8} />}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>Growth periode sebelumnya aktif setelah data pembanding tersedia.</div>
          </Section>
        )}
      </BlockState>

      <BlockState block={data.customer}>
        {(customer) => (
          <Section title="03 · CUSTOMER">
            <KpiGrid>
              <KpiCard label="Pelanggan baru" value={`${customer.classification.newCustomers}`} href={detailHref("/laporan/akuisisi", detailFilter)} />
              <KpiCard label="Repeat" value={`${customer.classification.repeatCustomers}`} href={detailHref("/laporan/retensi", detailFilter)} />
              <KpiCard label="Aktif" value={`${customer.classification.activeCustomers}`} />
              <KpiCard label="Dorman" value={`${customer.classification.dormantCustomers}`} tone={customer.classification.dormantCustomers ? "#b45309" : undefined} />
              <KpiCard label="Pelanggan terdata" value={`${customer.totalCustomers}`} />
            </KpiGrid>
            <div style={{ fontSize: 10.5, color: "var(--tm)" }}>
              Top spending: {customer.topSpenders.length ? customer.topSpenders.map((row) => `${row.customerId.slice(0, 8)} ${rupiah(row.spending)}`).join(" · ") : "Data belum tersedia"}
            </div>
          </Section>
        )}
      </BlockState>

      <BlockState block={data.stock}>
        {(stock) => (
          <Section title="04 · STOCK & OPERATION">
            <KpiGrid>
              <KpiCard label="Nilai stok" value={rupiah(stock.stockValue)} href="/pos/stok" />
              <KpiCard label="Coverage" value={stock.coverageDays === null ? "Data belum tersedia" : `${angka(stock.coverageDays)} hari`} />
              <KpiCard label="Stok minimum" value={`${stock.lowStock} item`} href="/pos/stok-minimum" tone={stock.lowStock ? "#b91c1c" : undefined} />
              <KpiCard label="Fast-moving" value={`${stock.fastMoving.length} item`} />
              <KpiCard label="Slow-moving" value={`${stock.slowMoving.length} item`} tone={stock.slowMoving.length ? "#b45309" : undefined} />
            </KpiGrid>
            <div style={{ display: "flex", gap: 8, fontSize: 10.5 }}>
              <Link href="/pos/expired" style={{ color: "#2563eb" }}>Monitor expired</Link>
              <Link href="/pos/kartu-stok" style={{ color: "#2563eb" }}>Kartu stok</Link>
            </div>
          </Section>
        )}
      </BlockState>

      <BlockState block={data.purchase}>
        {(purchase) => (
          <Section title="05 · PURCHASING">
            <KpiGrid>
              <KpiCard label="Pembelian" value={rupiah(purchase.purchase)} href={detailHref("/laporan/pembelian", detailFilter)} />
              <KpiCard label="Outstanding PO" value={angka(purchase.outstandingPoQty, 2)} href="/pembelian" tone={purchase.outstandingPoQty ? "#b45309" : undefined} />
              <KpiCard label="Supplier" value={`${purchase.supplierPerformance.length}`} href="/laporan/pembelian" />
            </KpiGrid>
            <div style={{ fontSize: 9.5, color: "var(--td)" }}>Ketepatan terhadap janji kirim belum tersedia karena tanggal janji belum tercatat.</div>
          </Section>
        )}
      </BlockState>

      <BlockState block={data.clinic}>
        {(clinic) => (
          <Section title="06 · CLINIC & SERVICE">
            <KpiGrid>
              <KpiCard label="Booking" value={`${clinic.branches.reduce((sum, row) => sum + row.bookings.total, 0)}`} href={detailHref("/laporan/rekap-klinik", detailFilter)} />
              <KpiCard label="No-show" value={`${clinic.branches.reduce((sum, row) => sum + row.bookings.noShow, 0)}`} tone="#b91c1c" />
              <KpiCard label="Kunjungan selesai" value={`${clinic.branches.reduce((sum, row) => sum + row.visits.selesai, 0)}`} />
              <KpiCard label="Tunggu rata-rata" value={`${angka(average(clinic.branches.map((row) => row.visits.avgWaitMinutes)))} menit`} />
              <KpiCard label="Layanan rata-rata" value={`${angka(average(clinic.branches.map((row) => row.visits.avgServiceMinutes)))} menit`} />
              <KpiCard label="Follow-up" value={persen(average(clinic.branches.map((row) => row.followUps.rate)))} />
            </KpiGrid>
            <div style={{ fontSize: 10.5, color: "var(--tm)" }}>Referral dan okupansi mengikuti data operasional klinik yang sudah tercatat.</div>
          </Section>
        )}
      </BlockState>
    </>
  );
}

function average(values: (number | null)[]): number | null {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}
