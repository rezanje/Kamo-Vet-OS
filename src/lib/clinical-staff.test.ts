import { expect, it } from 'vitest';
import { clinicalRoles, staffForService, inpatientStaffInput, performersForService } from './clinical-staff';
it('uses employee job roles, including existing DR HEWAN, without treating assistants as doctors',()=>{
 expect(clinicalRoles('Dokter Hewan Ranap - Poli')).toEqual(['doctor']);
 expect(clinicalRoles('DR HEWAN')).toEqual(['doctor']);
 expect(clinicalRoles('Asisten dokter')).toEqual(['paramedic']);
 expect(clinicalRoles('STAFF TOKO - GROOMER')).toEqual(['groomer']);
 expect(clinicalRoles(null)).toEqual([]);
 const staff=[{id:'doctor',jabatan:'Dokter'},{id:'groomer',jabatan:'Groomer'},{id:'admin',jabatan:'Admin',nama:'Drh. Fiction'}];
 expect(staffForService(staff,'Poli Umum').map(x=>x.id)).toEqual(['doctor']);
 expect(staffForService(staff,'Grooming').map(x=>x.id)).toEqual(['groomer']);
});
it('requires a doctor ID for doctor visits, while monitoring has its own optional paramedic ID',()=>{
 const data=new FormData();data.set('log_kind','doctor_visit');
 expect(()=>inpatientStaffInput(data)).toThrow('Dokter visit wajib');
 data.set('log_kind','monitoring');data.set('paramedic_id','d1000000-0000-4000-8000-000000000002');
 expect(inpatientStaffInput(data)).toEqual({log_kind:'monitoring',visit_doctor_id:null,paramedic_id:'d1000000-0000-4000-8000-000000000002'});
 data.set('paramedic_id','wrong');expect(()=>inpatientStaffInput(data)).toThrow();
 data.set('log_kind','legacy');expect(()=>inpatientStaffInput(data)).toThrow();
});

it('keeps actual doctors/nurses and groomers selectable as service performers',()=>{
 const staff=[{id:'doctor',jabatan:'DR HEWAN'},{id:'groomer',jabatan:'Groomer'},{id:'nurse',jabatan:'Perawat'},{id:'admin',jabatan:'Admin'}];
 expect(performersForService(staff,'Poli Umum').map(x=>x.id)).toEqual(['doctor','nurse']);
 expect(performersForService(staff,'Grooming').map(x=>x.id)).toEqual(['groomer','nurse']);
 expect(performersForService(staff,'Penitipan')).toEqual(staff);
});
