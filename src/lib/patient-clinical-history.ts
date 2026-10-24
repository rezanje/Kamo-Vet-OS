export type ClinicalPrescription={id:string;nama_obat:string;qty:number;satuan:string|null;jenis:string|null;aturan_pakai:string|null};
export type ClinicalRecord={id:string;created_at:string;diagnosis:string|null;anamnesis:string|null;therapy:string|null;prescriptions:ClinicalPrescription[]};
export type PatientClinicalVisit={id:string;pet_id:string;branch_id:string|null;branchName:string;created_at:string;poli:string;dokter:string|null;keluhan:string|null;records:ClinicalRecord[]};
export type PatientClinicalHistory={available:boolean;visits:PatientClinicalVisit[]};
