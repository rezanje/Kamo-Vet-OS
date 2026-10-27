export type ClinicalPrescription={id:string;nama_obat:string;qty:number;satuan:string|null;jenis:string|null;aturan_pakai:string|null};
/** K01 append-only note on a billed record; the original record stays unchanged. */
export type ClinicalAddendum={id:string;created_at:string;author:string|null;diagnosis:string|null;therapy:string|null;reason:string|null};
export type ClinicalRecord={id:string;created_at:string;diagnosis:string|null;anamnesis:string|null;therapy:string|null;prescriptions:ClinicalPrescription[];addenda?:ClinicalAddendum[]};
export type PatientClinicalVisit={id:string;pet_id:string;branch_id:string|null;branchName:string;created_at:string;poli:string;dokter:string|null;keluhan:string|null;records:ClinicalRecord[];canOpen?:boolean};
export type PatientClinicalHistory={available:boolean;visits:PatientClinicalVisit[]};
