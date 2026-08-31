import { createClient } from "@/lib/supabase/server";
import { LaporanPage } from "@/components/LaporanPage";
import { hariIniWIB } from "@/lib/tanggal";
import { buildPeriod, type Channel, type PeriodPreset } from "@/lib/operation-sales";
import { collectDashboard } from "@/lib/operation-sales-server";
import { OperationSalesDashboard } from "./OperationSalesDashboard";

const CHANNELS: Channel[] = ["all", "pos", "online", "reseller", "klinik"];
const PRESETS: PeriodPreset[] = ["today", "mtd", "custom"];

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function validRange(from: string, to: string): boolean {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 366 * 86_400_000;
}

export default async function OperationSalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const today = hariIniWIB();
  const rawPreset = one(sp.preset) ?? "mtd";
  const preset = PRESETS.includes(rawPreset as PeriodPreset) ? rawPreset as PeriodPreset : "mtd";
  const period = buildPeriod({
    preset,
    now: today,
    from: one(sp.from),
    to: one(sp.to),
  });
  const from = validRange(period.from, period.to) ? period.from : `${today.slice(0, 7)}-01`;
  const to = validRange(period.from, period.to) ? period.to : today;
  const rawChannel = one(sp.channel) ?? "all";
  const channel = CHANNELS.includes(rawChannel as Channel) ? rawChannel as Channel : "all";
  const branch = one(sp.branch) ?? "";
  const supabase = await createClient();
  let dashboard;
  try {
    dashboard = await collectDashboard(supabase, { from, to, branchIds: branch ? [branch] : [], channel });
  } catch {
    return (
      <LaporanPage icon="ti-dashboard" title="OPERATION & SALES" desc="Cockpit operasi, penjualan, customer, stok, pembelian, dan klinik.">
        <div className="crm-sec" style={{ color: "#b91c1c", fontSize: 11 }}>Akses cabang atau data dashboard belum dapat dibaca.</div>
      </LaporanPage>
    );
  }

  return (
    <LaporanPage
      icon="ti-dashboard"
      title="OPERATION & SALES"
      desc="Cockpit operasi, penjualan, customer, stok, pembelian, dan klinik."
      filter={
        <>
          <div>
            <label className="flab">Preset</label>
            <select className="fi" name="preset" defaultValue={preset}>
              <option value="today">Hari ini</option>
              <option value="mtd">Bulan berjalan</option>
              <option value="custom">Rentang custom</option>
            </select>
          </div>
          <div><label className="flab">Dari tanggal</label><input className="fi" type="date" name="from" defaultValue={from} /></div>
          <div><label className="flab">Sampai tanggal</label><input className="fi" type="date" name="to" defaultValue={to} /></div>
          <div style={{ minWidth: 190 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="branch" defaultValue={branch}>
              <option value="">Semua cabang yang boleh diakses</option>
              {dashboard.scope.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label className="flab">Kanal</label>
            <select className="fi" name="channel" defaultValue={channel}>
              <option value="all">Semua kanal</option>
              <option value="pos">POS</option>
              <option value="online">Online</option>
              <option value="reseller">Reseller</option>
              <option value="klinik">Klinik</option>
            </select>
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
    >
      <OperationSalesDashboard data={dashboard} />
    </LaporanPage>
  );
}
