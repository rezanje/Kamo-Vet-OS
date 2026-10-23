import { hasInpatientConsent } from './consent';
/** UX mirrors existing clinic_admit_inpatient guards; the RPC remains authoritative. */
export function clinicAdmissionReadiness(input:{
 readFailed:boolean;status:string;checkedOutAt:string|null;doctorId:string|null;medicalRecordId:string|null;
 rule:{wajib:boolean;template_id:string|null}|null;
 consents:readonly {status:string;kategori?:string|null;template_id?:string|null}[];
}):{canAdmit:boolean;reason:string|null;consentAction:boolean}{
 if(input.readFailed)return {canAdmit:false,reason:'Kesiapan rawat inap belum dapat diverifikasi. Muat ulang untuk memeriksa persetujuan dan status kunjungan; tidak perlu membuat persetujuan baru sebelum data terbaca.',consentAction:false};
 if(input.status==='Selesai'||input.checkedOutAt)return {canAdmit:false,reason:'Kunjungan sudah selesai atau check-out. Alur saat ini tidak dapat memasukkan kunjungan ini ke rawat inap; periksa kelanjutan perawatan dengan petugas klinik.',consentAction:false};
 if(!input.medicalRecordId||!input.doctorId)return {canAdmit:false,reason:'Selesaikan pemeriksaan dan pilih dokter terlebih dahulu sebelum masuk rawat inap.',consentAction:false};
 const valid=input.rule?.wajib===false||hasInpatientConsent(input.consents,input.rule?.template_id);
 return valid?{canAdmit:true,reason:null,consentAction:false}:{canAdmit:false,reason:'Buat dan tandatangani persetujuan khusus Rawat Inap pada kunjungan ini. Form umum dengan nama rawat inap belum memenuhi prasyarat.',consentAction:true};
}
