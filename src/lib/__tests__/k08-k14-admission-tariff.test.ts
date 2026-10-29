import { describe, expect, it } from "vitest";
import { clinicAdmissionReadiness, UNPAID_INVOICE_REASON } from "@/lib/clinic-admission-readiness";
import { petHotelTariffWarning, pickStayTariffs, type TariffRow } from "@/lib/inpatient-tariff";
import { readConsentStay } from "@/lib/inpatient-stay";
import { KATEGORI_CONSENT, TINDAKAN_KATEGORI, butuhConsent } from "@/lib/tindakan";
import { TEMPLATE_CATEGORIES } from "@/lib/consent";

const base = {
  readFailed: false, status: "Pembayaran", checkedOutAt: null, doctorId: "doc", medicalRecordId: "mr",
  rule: { wajib: true, template_id: null }, consents: [{ status: "sudah_ttd", kategori: "Rawat Inap", template_id: null }],
};

describe("K08 admission readiness: active unpaid invoice", () => {
  it("blocks the sick direct path with the pay-or-void reason", () => {
    const r = clinicAdmissionReadiness({ ...base, hasUnpaidInvoice: true });
    expect(r).toEqual({ canAdmit: false, reason: UNPAID_INVOICE_REASON, consentAction: false, continueFromClosed: false });
  });
  it("keeps the paid visit on the continuation path", () => {
    const r = clinicAdmissionReadiness({ ...base, hasPaidInvoice: true });
    expect(r.continueFromClosed).toBe(true);
    expect(r.canAdmit).toBe(false);
  });
  it("admits directly when there is no active invoice (e.g. after a void)", () => {
    expect(clinicAdmissionReadiness(base).canAdmit).toBe(true);
  });
});

describe("K14 pet hotel readiness", () => {
  it("needs no exam, doctor or inpatient consent", () => {
    const r = clinicAdmissionReadiness({
      ...base, stayType: "pet_hotel", status: "Menunggu", doctorId: null, medicalRecordId: null, consents: [],
    });
    expect(r).toEqual({ canAdmit: true, reason: null, consentAction: false, continueFromClosed: false });
  });
  it("is blocked by an active unpaid invoice and on a finished visit", () => {
    expect(clinicAdmissionReadiness({ ...base, stayType: "pet_hotel", hasUnpaidInvoice: true }).reason).toBe(UNPAID_INVOICE_REASON);
    const closed = clinicAdmissionReadiness({ ...base, stayType: "pet_hotel", status: "Selesai" });
    expect(closed.canAdmit).toBe(false);
    expect(closed.continueFromClosed).toBe(false);
    expect(closed.reason).toContain("Daftarkan kunjungan baru");
  });
  it("still refuses when readiness could not be read", () => {
    expect(clinicAdmissionReadiness({ ...base, stayType: "pet_hotel", readFailed: true }).canAdmit).toBe(false);
  });
});

describe("K14 Pet Hotel tariff", () => {
  const row = (id: string, name: string, kategori: string, price: number): TariffRow => ({ id, name, sell_price: price, tindakan_kategori: kategori });
  it("picks the first active service per category by name like the database", () => {
    const t = pickStayTariffs([row("b", "Rawat Inap B", "Rawat Inap", 1), row("a", "Rawat Inap A", "Rawat Inap", 2), row("h", "Pet Hotel", "Pet Hotel", 3)]);
    expect(t.sick?.id).toBe("a");
    expect(t.petHotel?.id).toBe("h");
    expect(t.feeItemIds).toEqual(["a", "h"]);
  });
  it("warns when the Pet Hotel price is unset and falls back to the Rawat Inap price", () => {
    const sick = row("s", "Rawat Inap", "Rawat Inap", 100000);
    expect(petHotelTariffWarning({ sick, petHotel: null })).toContain("memakai tarif Rawat Inap");
    expect(petHotelTariffWarning({ sick, petHotel: row("h", "Pet Hotel", "Pet Hotel", 0) })).toContain("memakai tarif Rawat Inap");
    expect(petHotelTariffWarning({ sick: null, petHotel: null })).toContain("belum ada di master jasa");
    expect(petHotelTariffWarning({ sick, petHotel: row("h", "Pet Hotel", "Pet Hotel", 75000) })).toBeNull();
  });
  it("is a service category but has no consent rule or consent template category", () => {
    expect(TINDAKAN_KATEGORI).toContain("Pet Hotel");
    expect(KATEGORI_CONSENT).not.toContain("Pet Hotel");
    expect(TEMPLATE_CATEGORIES).not.toContain("Pet Hotel");
    expect(butuhConsent([{ jenis: "jasa", kategori: "Pet Hotel" }])).toBe(false);
  });
});

describe("K14 readConsentStay", () => {
  function db(results: { data: unknown; error: unknown }[], calls: string[][]) {
    return {
      from: () => {
        const filters: string[] = [];
        const q = {
          select: () => q,
          eq: (col: string, val: string) => { filters.push(`${col}=${val}`); return q; },
          limit: () => q,
          maybeSingle: async () => { calls.push(filters); return results.shift(); },
        };
        return q;
      },
    } as never;
  }
  it("only counts sick stays", async () => {
    const calls: string[][] = [];
    const r = await readConsentStay(db([{ data: null, error: null }], calls), "v1");
    expect(r).toEqual({ data: null, error: null });
    expect(calls).toEqual([["visit_id=v1", "stay_type=sakit"]]);
  });
  it("treats every stay as sick before the K14 column exists", async () => {
    const calls: string[][] = [];
    const r = await readConsentStay(db([
      { data: null, error: { code: "42703", message: "column inpatient_records.stay_type does not exist" } },
      { data: { id: "s1", consent_id: "c1" }, error: null },
    ], calls), "v1");
    expect(r.data).toEqual({ id: "s1", consent_id: "c1" });
    expect(calls).toEqual([["visit_id=v1", "stay_type=sakit"], ["visit_id=v1"]]);
  });
  it("passes other read errors through so callers fail closed", async () => {
    const r = await readConsentStay(db([{ data: null, error: { message: "network" } }], []), "v1");
    expect(r.error).toEqual({ message: "network" });
  });
});
