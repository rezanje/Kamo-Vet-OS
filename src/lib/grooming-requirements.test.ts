import { expect, it } from "vitest";
import { groomingDoctorRequired, isGroomingOutlet, isGroomingService } from "./grooming-requirements";

it("recognizes saved grooming classification without guessing from the product name", () => {
  expect(isGroomingService("Jasa", "Grooming")).toBe(true);
  expect(isGroomingService("Jasa", "Konsultasi")).toBe(false);
  expect(isGroomingService("Barang", "Grooming")).toBe(false);
  expect(isGroomingService("Jasa", null)).toBe(false);
});

it("defaults clinic branches to doctor plus groomer, and lets each branch override it", () => {
  expect(groomingDoctorRequired("KLINIK", null)).toBe(true);
  expect(groomingDoctorRequired("BOTH", null)).toBe(true);
  expect(groomingDoctorRequired("PETSHOP", null)).toBe(false);
  expect(groomingDoctorRequired("KLINIK", false)).toBe(false);
  expect(groomingDoctorRequired("PETSHOP", true)).toBe(true);
  expect(isGroomingOutlet("PETSHOP")).toBe(true);
  expect(isGroomingOutlet("ONLINE")).toBe(false);
});
