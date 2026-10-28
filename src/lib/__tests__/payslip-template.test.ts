import { describe, expect, it } from "vitest";
import { komponenEfektif, type KomponenMaster } from "../payslip-template";

// Fictional amounts only; no production template or rate is configured here.
const master = (o: Partial<KomponenMaster> = {}): KomponenMaster => ({
  nama: "Tunjangan", tipe: "tunjangan", nominal: 100, is_active: true,
  calculation_basis: "fixed", sales_source: "semua", sales_scope: "employee", rate_percent: 0, ...o,
});

describe("H02 payslip template components", () => {
  it("template values override the master and apply to every linked employee", () => {
    const [row] = komponenEfektif([{ component_id: "c1", nominal: 250, rate_percent: null, master: master() }], []);
    expect(row).toMatchObject({ componentId: "c1", nominal: 250, asal: "template" });
  });

  it("an explicit employee row on the same component is an exception that wins", () => {
    const rows = komponenEfektif(
      [{ component_id: "c1", nominal: 250, rate_percent: null, master: master() }],
      [{ component_id: "c1", nominal: 300, rate_percent_override: null, master: master() }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ nominal: 300, asal: "pengecualian" });
  });

  it("an exception that leaves a value empty keeps the template value", () => {
    const turnover = master({ calculation_basis: "net_turnover", rate_percent: 1 });
    const [row] = komponenEfektif(
      [{ component_id: "c2", nominal: null, rate_percent: 2, master: turnover }],
      [{ component_id: "c2", nominal: null, rate_percent_override: null, master: turnover }],
    );
    expect(row).toMatchObject({ ratePercent: 2, asal: "pengecualian" });
  });

  it("employee rows outside the template are individual extras; inactive masters are skipped", () => {
    const rows = komponenEfektif(
      [{ component_id: "off", nominal: null, rate_percent: null, master: master({ is_active: false }) }],
      [{ component_id: "c3", nominal: null, rate_percent_override: null, master: master({ nominal: 40, tipe: "potongan" }) }],
    );
    expect(rows).toEqual([expect.objectContaining({ componentId: "c3", nominal: 40, asal: "individu" })]);
  });

  it("without a template the employee rows behave exactly as before", () => {
    const rows = komponenEfektif([], [{ component_id: "c1", nominal: null, rate_percent_override: null, master: master() }]);
    expect(rows).toEqual([expect.objectContaining({ nominal: 100, asal: "individu" })]);
  });
});
