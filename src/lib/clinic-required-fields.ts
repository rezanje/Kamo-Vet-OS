export function isMedicalService(service: string | null | undefined): boolean {
  return !/^(grooming|penitipan)$/i.test(service?.trim() ?? "");
}

export function validateClinicalCompletion(service: string | null | undefined, doctorId: string | null, complaint: string | null): string | null {
  if (!isMedicalService(service)) return null;
  if (!doctorId?.trim()) return "Pilih dokter sebelum melanjutkan pemeriksaan.";
  if (!complaint?.trim()) return "Keluhan pasien wajib diisi sebelum melanjutkan.";
  return null;
}
