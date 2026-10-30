import type { ServicePerformersSnapshot } from "./service-performers";
import type { BmhpInput } from "./procedure-bmhp";
export type ClinicalCorrection = {
  fullEdit?: boolean;
  recordId: string; revision: number;
  anamnesis: string | null; diagnosis: string | null; therapy: string | null;
  suhu: number | null; berat: number | null; gejala_klinis: string | null; hasil_penunjang: string | null;
  penunjang_urls: string[] | null; follow_up: string | null; catatan_resep: string | null;
  prescriptions: { id?: string; item_id?: string | null; harga?: number; faktor?: number; jenis?: string; kategori?: string | null; compound_recipe_id?: string | null; bmhp_components?: (BmhpInput & { name?: string })[] | null; nama_obat: string; qty: number; satuan?: string | null; aturan_pakai: string | null; service_performers?: ServicePerformersSnapshot | null }[];
  compounds?: { id: string; recipe_name: string; status: string }[];
};
