import Link from "next/link";
import {
  alertDetailHref,
  alertRuleLabel,
  type AlertEvaluation,
  type AlertRuleKey,
  type OperationalAlert,
} from "@/lib/operational-alerts";
import type { DashboardBlock } from "@/lib/operation-sales-server";

function value(ruleKey: AlertRuleKey, amount: number): string {
  if (ruleKey === "stock_opname_variance") return `Rp ${Math.round(amount).toLocaleString("id-ID")}`;
  if (ruleKey === "sales_below_target" || ruleKey === "sales_drop") return `${amount.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
  if (ruleKey === "expired_or_near_expiry") return `${amount.toLocaleString("id-ID")} hari`;
  return amount.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

function AlertCard({ alert, filter }: {
  alert: OperationalAlert;
  filter: { from: string; to: string };
}) {
  const red = alert.severity === "red";
  const href = alertDetailHref(alert.detailUrl, { ...filter, branchName: alert.branchName });
  const body = (
    <div className="crm-sec" style={{ margin: 0, borderColor: red ? "#fca5a5" : "#fde68a", background: red ? "#fef2f2" : "#fffbeb", minWidth: 230, flex: "1 1 230px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: red ? "#991b1b" : "#92400e" }}>{alert.label}</div>
        <i className={`ti ${red ? "ti-alert-triangle" : "ti-alert-circle"}`} style={{ color: red ? "#dc2626" : "#d97706" }} />
      </div>
      <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 5 }}>{alert.branchName} · {alert.periodLabel}</div>
      <div style={{ fontSize: 10.5, color: "var(--sb)", marginTop: 6 }}>Aktual <b>{value(alert.ruleKey, alert.actual)}</b> · Batas <b>{value(alert.ruleKey, alert.threshold)}</b></div>
      {href && <div style={{ fontSize: 10.5, color: "#2563eb", marginTop: 7 }}>Buka detail <i className="ti ti-arrow-right" /></div>}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: "none", display: "flex", flex: "1 1 230px" }}>{body}</Link> : body;
}

export function OperationalAlertPanel({
  block,
  filter,
  showDiagnostics,
}: {
  block: DashboardBlock<AlertEvaluation>;
  filter: { from: string; to: string };
  showDiagnostics: boolean;
}) {
  if (block.status === "missing") {
    return <section className="crm-sec" style={{ marginBottom: 12, color: "var(--tm)", fontSize: 11 }}>Alert belum tersedia. {block.reason}.</section>;
  }
  if (block.status === "error") {
    return <section className="crm-sec" style={{ marginBottom: 12, color: "#b91c1c", fontSize: 11 }}>Alert gagal dimuat. ID pelacakan: {block.correlationId}</section>;
  }

  return (
    <section className="crm-sec" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, fontWeight: 800 }}>ALERT OPERASIONAL</div>
        {showDiagnostics && <Link href="/pengaturan/alert-operasional" style={{ fontSize: 10.5, color: "#2563eb" }}>Atur ambang</Link>}
      </div>
      {block.data.alerts.length > 0
        ? <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>{block.data.alerts.map((alert) => <AlertCard key={`${alert.ruleKey}:${alert.branchId}`} alert={alert} filter={filter} />)}</div>
        : <div style={{ fontSize: 11, color: "#15803d" }}><i className="ti ti-circle-check" /> Tidak ada alert aktif pada periode ini.</div>}
      {showDiagnostics && block.data.missing.length > 0 && (
        <details style={{ marginTop: 10, fontSize: 10.5, color: "var(--tm)" }}>
          <summary>{block.data.missing.length} sumber data belum lengkap</summary>
          <ul style={{ marginBottom: 0 }}>
            {block.data.missing.map((item, index) => <li key={`${item.ruleKey}:${index}`}>{alertRuleLabel(item.ruleKey)}: {item.reason}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
