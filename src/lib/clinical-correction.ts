import type { ServicePerformersSnapshot } from "./service-performers";
export type ClinicalCorrection = {
  recordId: string; revision: number;
  anamnesis: string | null; diagnosis: string | null; therapy: string | null;
  suhu: number | null; berat: number | null; gejala_klinis: string | null; hasil_penunjang: string | null;
  penunjang_urls: string[] | null; follow_up: string | null; catatan_resep: string | null;
  prescriptions: { nama_obat: string; qty: number; satuan?: string | null; aturan_pakai: string | null; service_performers?: ServicePerformersSnapshot | null }[];
  compounds?: { id: string; recipe_name: string; status: string }[];
};
