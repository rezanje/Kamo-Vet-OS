import { describe, expect, it } from "vitest";
import { hasInpatientConsent } from "../consent";

describe("specific inpatient consent", () => {
  it("does not accept a signed general document", () => {
    expect(hasInpatientConsent([{ status: "sudah_ttd", kategori: "Umum", template_id: "general" }])).toBe(false);
  });
  it("requires a signed inpatient document and the configured template", () => {
    const signed = { status: "sudah_ttd", kategori: "Rawat Inap", template_id: "inpatient" };
    expect(hasInpatientConsent([signed], "inpatient")).toBe(true);
    expect(hasInpatientConsent([signed], "another")).toBe(false);
    expect(hasInpatientConsent([{ ...signed, status: "belum_ttd" }], "inpatient")).toBe(false);
  });
  it("accepts a typed document when no default template is configured", () => {
    expect(hasInpatientConsent([{ status: "sudah_ttd", kategori: "Rawat Inap", template_id: "selected" }], null)).toBe(true);
    expect(hasInpatientConsent([])).toBe(false);
  });
});
