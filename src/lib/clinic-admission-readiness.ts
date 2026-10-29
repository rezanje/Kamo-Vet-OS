import { hasInpatientConsent } from './consent';
/**
 * UX mirrors clinic_admit_inpatient / clinic_admit_inpatient_typed / clinic_continue_visit_to_inpatient
 * guards; the RPCs remain authoritative.
 * K06: a paid/closed outpatient visit is not admitted directly (its invoice must stay untouched); it is
 * continued to inpatient through a linked continuation visit that gets its own invoice.
 * K08 (owner decision 29 Oct): an active UNPAID invoice blocks admission until it is paid (then continue)
 * or voided (then admit directly).
 * K14: a pet hotel (healthy boarding) check-in needs no doctor examination, no doctor and no inpatient
 * consent; the sick inpatient keeps every requirement.
 */
export const UNPAID_INVOICE_REASON='Tagihan kunjungan ini masih aktif dan belum lunas. Lunasi atau batalkan (void) tagihan terlebih dahulu: setelah lunas, pasien dilanjutkan ke rawat inap lewat kunjungan lanjutan; setelah dibatalkan, pasien bisa dimasukkan langsung.';
export function clinicAdmissionReadiness(input:{
 readFailed:boolean;status:string;checkedOutAt:string|null;doctorId:string|null;medicalRecordId:string|null;
 hasPaidInvoice?:boolean;
 hasUnpaidInvoice?:boolean;
 stayType?:'sakit'|'pet_hotel';
 rule:{wajib:boolean;template_id:string|null}|null;
 consents:readonly {status:string;kategori?:string|null;template_id?:string|null}[];
}):{canAdmit:boolean;reason:string|null;consentAction:boolean;continueFromClosed:boolean}{
 const no=(reason:string,consentAction=false)=>({canAdmit:false,reason,consentAction,continueFromClosed:false});
 const closed=input.status==='Selesai'||!!input.checkedOutAt||!!input.hasPaidInvoice;
 if(input.readFailed)return no('Kesiapan rawat inap belum dapat diverifikasi. Muat ulang untuk memeriksa persetujuan dan status kunjungan; tidak perlu membuat persetujuan baru sebelum data terbaca.');
 if(input.stayType==='pet_hotel'){
  if(closed)return no('Kunjungan ini sudah selesai atau lunas. Daftarkan kunjungan baru untuk check-in pet hotel.');
  if(input.hasUnpaidInvoice)return no(UNPAID_INVOICE_REASON);
  return {canAdmit:true,reason:null,consentAction:false,continueFromClosed:false};
 }
 if(!input.medicalRecordId||!input.doctorId)return no('Selesaikan pemeriksaan dan pilih dokter terlebih dahulu sebelum masuk rawat inap.');
 if(closed)return {canAdmit:false,reason:'Kunjungan rawat jalan ini sudah selesai atau lunas. Lanjutkan ke rawat inap: tagihan lama tidak diubah, biaya rawat inap ditagih di invoice terpisah.',consentAction:false,continueFromClosed:true};
 if(input.hasUnpaidInvoice)return no(UNPAID_INVOICE_REASON);
 const valid=input.rule?.wajib===false||hasInpatientConsent(input.consents,input.rule?.template_id);
 return valid?{canAdmit:true,reason:null,consentAction:false,continueFromClosed:false}:no('Buat dan tandatangani persetujuan khusus Rawat Inap pada kunjungan ini. Form umum dengan nama rawat inap belum memenuhi prasyarat.',true);
}
