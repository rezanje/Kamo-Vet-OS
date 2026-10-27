import { hasInpatientConsent } from './consent';
/**
 * UX mirrors clinic_admit_inpatient / clinic_continue_visit_to_inpatient guards; the RPCs remain authoritative.
 * K06: a paid/closed outpatient visit is not admitted directly (its invoice must stay untouched); it is
 * continued to inpatient through a linked continuation visit that gets its own invoice.
 */
export function clinicAdmissionReadiness(input:{
 readFailed:boolean;status:string;checkedOutAt:string|null;doctorId:string|null;medicalRecordId:string|null;
 hasActiveInvoice?:boolean;
 rule:{wajib:boolean;template_id:string|null}|null;
 consents:readonly {status:string;kategori?:string|null;template_id?:string|null}[];
}):{canAdmit:boolean;reason:string|null;consentAction:boolean;continueFromClosed:boolean}{
 const no=(reason:string,consentAction=false)=>({canAdmit:false,reason,consentAction,continueFromClosed:false});
 if(input.readFailed)return no('Kesiapan rawat inap belum dapat diverifikasi. Muat ulang untuk memeriksa persetujuan dan status kunjungan; tidak perlu membuat persetujuan baru sebelum data terbaca.');
 if(!input.medicalRecordId||!input.doctorId)return no('Selesaikan pemeriksaan dan pilih dokter terlebih dahulu sebelum masuk rawat inap.');
 if(input.status==='Selesai'||input.checkedOutAt||input.hasActiveInvoice)return {canAdmit:false,reason:'Kunjungan rawat jalan ini sudah selesai atau sudah ditagih. Lanjutkan ke rawat inap: tagihan lama tidak diubah, biaya rawat inap ditagih di invoice terpisah.',consentAction:false,continueFromClosed:true};
 const valid=input.rule?.wajib===false||hasInpatientConsent(input.consents,input.rule?.template_id);
 return valid?{canAdmit:true,reason:null,consentAction:false,continueFromClosed:false}:no('Buat dan tandatangani persetujuan khusus Rawat Inap pada kunjungan ini. Form umum dengan nama rawat inap belum memenuhi prasyarat.',true);
}
