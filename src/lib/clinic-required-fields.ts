export function isMedicalService(service: string | null | undefined): boolean {
  return !/^(grooming|penitipan)$/i.test(service?.trim() ?? "");
}

export function validateClinicalCompletion(service: string | null | undefined, doctorId: string | null, complaint: string | null): string | null {
  if (!isMedicalService(service)) return null;
  if (!doctorId?.trim()) return "Pilih dokter sebelum melanjutkan pemeriksaan.";
  if (!complaint?.trim()) return "Keluhan pasien wajib diisi sebelum melanjutkan.";
  return null;
}

/**
 * SOAP wajib untuk poli medis (permintaan klinik 10 Nov): rekam medis dibaca dokter lain saat
 * pasien kembali, jadi tidak boleh ada komponen yang terlewat.
 *  S = keluhan (dicek validateClinicalCompletion) + anamnesa
 *  O = gejala klinis / temuan pemeriksaan fisik (berat, suhu, penunjang tetap opsional)
 *  A = diagnosa
 *  P = terapi / rencana — atau sudah ada obat, jasa, tindakan, racikan, atau follow up.
 * Grooming dan penitipan bukan kunjungan medis, tidak terkena.
 */
export type SoapInput = {
  anamnesis: string | null | undefined;
  gejalaKlinis: string | null | undefined;
  diagnosis: string | null | undefined;
  therapy: string | null | undefined;
  /** Ada obat/jasa/tindakan/racikan/follow up yang tercatat — itu juga rencana (P). */
  adaRencana: boolean;
};

export const SOAP_MESSAGES = {
  anamnesis: "Anamnesa (S) wajib diisi: riwayat & perjalanan penyakit dari pemilik.",
  gejalaKlinis: "Gejala klinis / temuan pemeriksaan fisik (O) wajib diisi.",
  diagnosis: "Diagnosa (A) wajib diisi.",
  therapy: "Terapi / rencana (P) wajib diisi, atau masukkan obat, jasa, tindakan, atau follow up.",
} as const;

const kosong = (value: string | null | undefined) => !value?.trim();

export function validateSoapCompletion(service: string | null | undefined, soap: SoapInput): string | null {
  if (!isMedicalService(service)) return null;
  if (kosong(soap.anamnesis)) return SOAP_MESSAGES.anamnesis;
  if (kosong(soap.gejalaKlinis)) return SOAP_MESSAGES.gejalaKlinis;
  if (kosong(soap.diagnosis)) return SOAP_MESSAGES.diagnosis;
  if (kosong(soap.therapy) && !soap.adaRencana) return SOAP_MESSAGES.therapy;
  return null;
}
