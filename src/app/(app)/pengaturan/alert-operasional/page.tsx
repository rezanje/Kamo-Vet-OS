import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { defaultAlertSettings, type AlertSetting } from "@/lib/operational-alerts";
import { AlertSettingsForm } from "./AlertSettingsForm";

function rowToSetting(row: Record<string, unknown>): AlertSetting {
  return {
    ruleKey: row.rule_key as AlertSetting["ruleKey"],
    branchId: typeof row.branch_id === "string" ? row.branch_id : null,
    threshold: row.threshold === null ? null : Number(row.threshold),
    periodDays: row.period_days === null ? null : Number(row.period_days),
    active: row.active === true,
    severity: row.severity === "yellow" ? "yellow" : "red",
  };
}

export default async function AlertOperasionalSettings({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: profile }, { data: branches }, { data: rows }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("branches").select("id,name").eq("is_active", true).order("name"),
    supabase.from("operational_alert_settings").select("rule_key,branch_id,threshold,period_days,active,severity").order("rule_key"),
  ]);
  const allowed = profile?.role === "OWNER" || profile?.role === "ADMIN";
  const settings = (rows ?? []).map((row) => rowToSetting(row));
  const savedCompany = new Map(settings.filter((setting) => setting.branchId === null).map((setting) => [setting.ruleKey, setting]));
  const companySettings = defaultAlertSettings().map((setting) => savedCompany.get(setting.ruleKey) ?? setting);
  const overrides = settings.filter((setting) => setting.branchId !== null);

  return (
    <>
      <div style={{ marginBottom: 4 }}><Link href="/pengaturan" className="back-btn"><i className="ti ti-arrow-left" /> Pengaturan</Link></div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center" }}><i className="ti ti-bell-ringing" style={{ fontSize: 22, color: "#dc2626" }} /></div>
        <div><div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>ALERT OPERASIONAL</div><div style={{ fontSize: 11.5, color: "var(--tm)" }}>Ambang perusahaan dan pengecualian per cabang</div></div>
      </div>
      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#f0fdf4", border: ".5px solid #86efac", color: "#166534" }}><i className="ti ti-circle-check" /> Pengaturan alert tersimpan.</div>}
      {allowed
        ? <AlertSettingsForm companySettings={companySettings} overrides={overrides} branches={branches ?? []} />
        : <div className="p2ban"><i className="ti ti-lock" /> Hanya OWNER/ADMIN yang bisa mengubah alert operasional.</div>}
    </>
  );
}
