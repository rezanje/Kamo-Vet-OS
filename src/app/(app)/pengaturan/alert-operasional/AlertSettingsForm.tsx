import { SubmitButton } from "@/components/SubmitButton";
import {
  ALERT_RULE_KEYS,
  alertRuleLabel,
  type AlertRuleKey,
  type AlertSetting,
} from "@/lib/operational-alerts";
import { simpanAlertOperasional } from "./actions";

type Branch = { id: string; name: string };

function Fields({ setting }: { setting: AlertSetting }) {
  return (
    <>
      <label className="flab">Ambang
        <input className="fi" name="threshold" type="number" min="0" step="any" defaultValue={setting.threshold ?? ""} />
      </label>
      <label className="flab">Periode (hari)
        <input className="fi" name="period_days" type="number" min="1" step="1" required defaultValue={setting.periodDays ?? 30} />
      </label>
      <label className="flab">Prioritas
        <select className="fi" name="severity" defaultValue={setting.severity}>
          <option value="red">Merah</option>
          <option value="yellow">Kuning</option>
        </select>
      </label>
      <label className="flab" style={{ justifyContent: "flex-end" }}>
        <span><input name="active" type="checkbox" defaultChecked={setting.active} /> Aktif</span>
      </label>
    </>
  );
}

function RuleForm({ setting, branchName }: { setting: AlertSetting; branchName?: string }) {
  return (
    <form action={simpanAlertOperasional} className="crm-sec" style={{ marginBottom: 10 }}>
      <input type="hidden" name="rule_key" value={setting.ruleKey} />
      <input type="hidden" name="branch_id" value={setting.branchId ?? ""} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 800, color: "var(--sb)" }}>{alertRuleLabel(setting.ruleKey)}</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>{branchName ?? "Berlaku untuk semua cabang"}</div>
        </div>
        <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…">Simpan</SubmitButton>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginTop: 10 }}>
        <Fields setting={setting} />
      </div>
    </form>
  );
}

export function AlertSettingsForm({
  companySettings,
  overrides,
  branches,
}: {
  companySettings: AlertSetting[];
  overrides: AlertSetting[];
  branches: Branch[];
}) {
  const defaults = new Map(companySettings.map((setting) => [setting.ruleKey, setting]));
  return (
    <>
      <section style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 9, color: "var(--sb)" }}>Aturan perusahaan</div>
        {ALERT_RULE_KEYS.map((ruleKey) => (
          <RuleForm key={ruleKey} setting={defaults.get(ruleKey)!} />
        ))}
      </section>

      <section className="crm-sec" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Tambah pengecualian cabang</div>
        <form action={simpanAlertOperasional} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 10 }}>
          <label className="flab">Aturan
            <select className="fi" name="rule_key" required>
              {ALERT_RULE_KEYS.map((ruleKey) => <option key={ruleKey} value={ruleKey}>{alertRuleLabel(ruleKey)}</option>)}
            </select>
          </label>
          <label className="flab">Cabang
            <select className="fi" name="branch_id" required>
              <option value="">Pilih cabang…</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <Fields setting={{ ruleKey: "sales_below_target", branchId: null, threshold: null, periodDays: 30, active: false, severity: "red" }} />
          <div style={{ alignSelf: "end" }}><SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…">Simpan pengecualian</SubmitButton></div>
        </form>
      </section>

      {overrides.length > 0 && (
        <section>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 9, color: "var(--sb)" }}>Pengecualian aktif per cabang</div>
          {overrides.map((setting) => (
            <RuleForm
              key={`${setting.ruleKey}:${setting.branchId}`}
              setting={setting}
              branchName={branches.find((branch) => branch.id === setting.branchId)?.name ?? "Cabang"}
            />
          ))}
        </section>
      )}
    </>
  );
}
