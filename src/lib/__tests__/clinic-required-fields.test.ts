import { describe, expect, it } from "vitest";
import { validateClinicalCompletion } from "../clinic-required-fields";

describe("mandatory clinical completion", () => {
  it("rejects missing doctor or blank complaint on medical visits", () => {
    expect(validateClinicalCompletion("Poli Umum", null, "Sakit")).toBe("Pilih dokter sebelum melanjutkan pemeriksaan.");
    expect(validateClinicalCompletion("Poli Umum", "doctor", "  ")).toBe("Keluhan pasien wajib diisi sebelum melanjutkan.");
    expect(validateClinicalCompletion(null, null, "Sakit")).toBe("Pilih dokter sebelum melanjutkan pemeriksaan.");
  });
  it("accepts complete medical data", () => {
    expect(validateClinicalCompletion("Poli Umum", "doctor", "Batuk")).toBeNull();
  });
  it.each(["Grooming", "Penitipan"])("does not require a medical doctor for %s", service => {
    expect(validateClinicalCompletion(service, null, null)).toBeNull();
  });
});
