import { describe, expect, it } from "vitest";
import { canSign, hasSignedConsent, renderTemplate, templatesForBranch } from "../consent";

describe("renderTemplate", () => {
  it("fills known placeholders", () => {
    const out = renderTemplate(
      "Saya {nama_pemilik} menyetujui {tindakan} pada {nama_hewan}.",
      { nama_pemilik: "Aldi", tindakan: "operasi steril", nama_hewan: "Michi" },
    );
    expect(out).toBe("Saya Aldi menyetujui operasi steril pada Michi.");
  });

  it("leaves unknown placeholders visible so typos are caught in the document", () => {
    expect(renderTemplate("Hai {nama_pemilikk}", { nama_pemilik: "Aldi" })).toBe("Hai {nama_pemilikk}");
  });

  it("leaves the placeholder when the value is empty rather than blanking the sentence", () => {
    expect(renderTemplate("Dokter: {dokter}", { dokter: "" })).toBe("Dokter: {dokter}");
  });

  it("replaces every occurrence", () => {
    expect(renderTemplate("{nama_hewan} dan {nama_hewan}", { nama_hewan: "Momo" })).toBe("Momo dan Momo");
  });
});

describe("canSign", () => {
  it("needs both a name and a signature image", () => {
    expect(canSign("Aldi", "data:image/png;base64,xx")).toBe(true);
    expect(canSign("", "data:image/png;base64,xx")).toBe(false);
    expect(canSign("Aldi", "")).toBe(false);
    expect(canSign("   ", "data:image/png;base64,xx")).toBe(false);
  });
});

describe("hasSignedConsent", () => {
  it("is true only when at least one consent is signed", () => {
    expect(hasSignedConsent([{ status: "belum_ttd" }, { status: "sudah_ttd" }])).toBe(true);
    expect(hasSignedConsent([{ status: "belum_ttd" }])).toBe(false);
    expect(hasSignedConsent([])).toBe(false);
  });
});

describe("templatesForBranch", () => {
  const rows = [
    { id: "a", branch_id: null, is_active: true },
    { id: "b", branch_id: "br-1", is_active: true },
    { id: "c", branch_id: "br-2", is_active: true },
    { id: "d", branch_id: null, is_active: false },
  ];

  it("keeps all-branch templates plus the ones for that branch", () => {
    expect(templatesForBranch(rows, "br-1").map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("drops inactive templates", () => {
    expect(templatesForBranch(rows, "br-1").map((t) => t.id)).not.toContain("d");
  });

  it("keeps only all-branch templates when there is no branch", () => {
    expect(templatesForBranch(rows, null).map((t) => t.id)).toEqual(["a"]);
  });
});
