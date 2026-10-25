/** Use the saved service category, never a product-name substring. */
export function isGroomingService(itemType: string | null | undefined, category: string | null | undefined) {
  return itemType === "Jasa" && category === "Grooming";
}

export function isGroomingOutlet(branchType: string | null | undefined) {
  return branchType === "PETSHOP" || branchType === "KLINIK" || branchType === "BOTH";
}

/** A branch override is optional; existing branch type remains the default. */
export function groomingDoctorRequired(branchType: string, override: boolean | null | undefined) {
  return override ?? (branchType === "KLINIK" || branchType === "BOTH");
}
