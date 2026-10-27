"use client";
import type { ClinicalStaff, InpatientStaff } from '@/lib/clinical-staff';
export function InpatientStaffFields({value,onChange,doctors,paramedics,disabled=false,legacyName,doctorName,paramedicName,lockVisit=false,savedKind}:{
 value:InpatientStaff;onChange:(value:InpatientStaff)=>void;doctors:ClinicalStaff[];paramedics:ClinicalStaff[];disabled?:boolean;
 legacyName?:string|null;doctorName?:string|null;paramedicName?:string|null;
 /** H06: editing a saved row without Admin/Owner rights — visit kind/doctor cannot change. */
 lockVisit?:boolean;savedKind?:InpatientStaff['log_kind'];
}) {
 // A saved visit keeps its kind and doctor; a saved monitoring note cannot become a visit.
 const visitLocked=lockVisit&&savedKind==='doctor_visit';
 const noNewVisit=lockVisit&&savedKind!=='doctor_visit';
 const options=(rows:ClinicalStaff[],id:string|null,name?:string|null)=>id&&!rows.some(row=>row.id===id)?[{id,nama:`${name??'Petugas'} (tersimpan)`,jabatan:null},...rows]:rows;
 return <fieldset disabled={disabled} style={{border:0,padding:0,margin:0,display:'grid',gap:8}}>
  <label className="flab">Jenis laporan{visitLocked&&<input type="hidden" name="log_kind" value="doctor_visit"/>}{visitLocked&&value.visit_doctor_id&&<input type="hidden" name="visit_doctor_id" value={value.visit_doctor_id}/>}
  <select className="fi" name={visitLocked?undefined:'log_kind'} disabled={visitLocked} aria-label="Jenis laporan" value={value.log_kind??'legacy'} onChange={event=>onChange({...value,log_kind:event.target.value==='legacy'?null:event.target.value as InpatientStaff['log_kind']})}>
   {value.log_kind===null&&<option value="legacy">Catatan lama (identitas tersimpan)</option>}
   <option value="monitoring">Pemantauan / perawatan</option>{(!noNewVisit||value.log_kind==='doctor_visit')&&<option value="doctor_visit">Visit dokter</option>}
  </select></label>
  {value.log_kind===null?<small>Dokter catatan lama: {legacyName??'—'}. Pilih jenis laporan untuk menautkan petugas.</small>:<>
   <label className="flab">Dokter visit{value.log_kind==='doctor_visit'?' *':''}<select className="fi" name={visitLocked?undefined:'visit_doctor_id'} disabled={visitLocked} aria-label="Dokter visit" required={!visitLocked&&value.log_kind==='doctor_visit'} value={value.visit_doctor_id??''} onChange={event=>onChange({...value,visit_doctor_id:event.target.value||null})}>
    <option value="">— tanpa dokter visit —</option>{options(doctors,value.visit_doctor_id,doctorName).map(row=><option key={row.id} value={row.id}>{row.nama}</option>)}
   </select></label>
   {visitLocked&&<small>Koreksi waktu/dokter visit oleh Admin/Owner.</small>}
   <label className="flab">Paramedis yang membantu (opsional)<select className="fi" name="paramedic_id" aria-label="Paramedis yang membantu" value={value.paramedic_id??''} onChange={event=>onChange({...value,paramedic_id:event.target.value||null})}>
    <option value="">— tanpa paramedis —</option>{options(paramedics,value.paramedic_id,paramedicName).map(row=><option key={row.id} value={row.id}>{row.nama}</option>)}
   </select></label>
  </>}
 </fieldset>;
}
