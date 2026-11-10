import { describe, expect, it } from "vitest";
import { SOAP_MESSAGES, validateSoapCompletion, type SoapInput } from "@/lib/clinic-required-fields";

// Klinik 10 Nov: kasus Nala masuk rawat inap dengan anamnesa & diagnosa kosong.
// S (anamnesa), O (gejala klinis/temuan fisik), A (diagnosa), P (terapi/rencana) tidak boleh terlewat.
const lengkap: SoapInput = { anamnesis: "Diare sejak 2 hari", gejalaKlinis: "Dehidrasi ringan", diagnosis: "Gastroenteritis", therapy: "Infus, observasi", adaRencana: false };

describe("validateSoapCompletion", () => {
  it("meloloskan SOAP lengkap", () => {
    expect(validateSoapCompletion("Poli Umum", lengkap)).toBeNull();
  });
  it.each([
    ["anamnesis", SOAP_MESSAGES.anamnesis],
    ["gejalaKlinis", SOAP_MESSAGES.gejalaKlinis],
    ["diagnosis", SOAP_MESSAGES.diagnosis],
    ["therapy", SOAP_MESSAGES.therapy],
  ] as const)("menolak %s kosong atau hanya spasi", (field, message) => {
    expect(validateSoapCompletion("Poli Umum", { ...lengkap, [field]: null })).toBe(message);
    expect(validateSoapCompletion("Poli Umum", { ...lengkap, [field]: "   \n" })).toBe(message);
  });
  it("kasus Nala: keluhan dari admin saja tidak cukup", () => {
    expect(validateSoapCompletion("Poli Umum", { anamnesis: null, gejalaKlinis: null, diagnosis: null, therapy: null, adaRencana: true }))
      .toBe(SOAP_MESSAGES.anamnesis);
  });
  it("rencana (P) boleh diwakili obat/jasa/tindakan/follow up", () => {
    expect(validateSoapCompletion("Poli Umum", { ...lengkap, therapy: "", adaRencana: true })).toBeNull();
  });
  it.each(["Grooming", "penitipan", " GROOMING "])("tidak berlaku untuk %s", (poli) => {
    expect(validateSoapCompletion(poli, { anamnesis: null, gejalaKlinis: null, diagnosis: null, therapy: null, adaRencana: false })).toBeNull();
  });
  it("poli kosong tetap dianggap medis", () => {
    expect(validateSoapCompletion(null, { ...lengkap, diagnosis: "" })).toBe(SOAP_MESSAGES.diagnosis);
  });
});
