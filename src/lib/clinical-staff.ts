import { isMedicalService } from './clinic-required-fields';
export type ClinicalRole = 'doctor' | 'paramedic' | 'groomer';
export type ClinicalStaff = { id: string; nama: string; jabatan: string | null };
export type InpatientStaff = { log_kind: 'monitoring' | 'doctor_visit' | null; visit_doctor_id: string | null; paramedic_id: string | null };
export function clinicalRoles(job: string | null): ClinicalRole[] {
  const text=(job ?? '').trim().toLowerCase(),roles:ClinicalRole[]=[];
  if (/paramedis|perawat|nurse|asisten.*(?:dokter|doctor)|vet.*technician/.test(text)) roles.push('paramedic');
  if (!roles.includes('paramedic') && /dokter|doctor|drh|\bdr\s+hewan\b/.test(text)) roles.push('doctor');
  if (/groomer|grooming/.test(text)) roles.push('groomer');
  return roles;
}
// Isian "Groomer" poli Grooming (Anisa, 20 Nov 2026): di klinik yang menggroming adalah paramedis (Cimanggu: 107 dari 107
// kunjungan grooming sebulan terakhir kosong karena groomernya berjabatan Paramedis dan tidak ada di daftar). Groomer tetap
// didahulukan, paramedis menyusul; jabatan lain tidak ditawarkan. Aturan pelaksana baris tagihan dan cetakan TIDAK berubah.
export function staffForService<T extends {jabatan:string|null}>(staff:T[],service?:string|null):T[] {
  if (service?.trim().toLowerCase()==='grooming') {
    const groomer=staff.filter(row=>clinicalRoles(row.jabatan).includes('groomer'));
    return [...groomer,...staff.filter(row=>!groomer.includes(row)&&clinicalRoles(row.jabatan).includes('paramedic'))];
  }
  return isMedicalService(service)?staff.filter(row=>clinicalRoles(row.jabatan).includes('doctor')):staff;
}
export function performersForService<T extends {jabatan:string|null}>(staff:T[],service?:string|null):T[] {
  const lead:ClinicalRole=service?.trim().toLowerCase()==='grooming'?'groomer':'doctor';
  if(!isMedicalService(service)&&lead!=='groomer')return staff;
  return staff.filter(row=>clinicalRoles(row.jabatan).some(role=>role===lead||role==='paramedic'));
}
export function inpatientStaffInput(data:FormData,allowLegacy=false):InpatientStaff {
  const raw=String(data.get('log_kind') ?? 'monitoring');
  if (!['monitoring','doctor_visit',...(allowLegacy?['legacy']:[])].includes(raw)) throw Error('Jenis laporan tidak valid');
  const id=(key:string)=>{const value=String(data.get(key)??'').trim();if(value&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw Error('Pilih petugas dari master karyawan');return value||null;};
  const doctor=id('visit_doctor_id'),paramedic=id('paramedic_id');
  if(raw==='doctor_visit'&&!doctor)throw Error('Dokter visit wajib dipilih untuk laporan visit dokter');
  return {log_kind:raw==='legacy'?null:raw as InpatientStaff['log_kind'],visit_doctor_id:doctor,paramedic_id:paramedic};
}
