import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('next/navigation',()=>({useRouter:()=>({push(){},replace(){},refresh(){}}),usePathname:()=>'/klinik/rawat-inap/stay/catatan',useSearchParams:()=>new URLSearchParams()}));
vi.mock('@/app/(app)/klinik/rawat-inap/actions',()=>({addDailyLogPos:async()=>({saved:true,href:'/'})}));
import { InpatientStaffFields } from '@/components/InpatientStaffFields';
import { CatatanForm } from '@/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm';
const render=(petHotel:boolean,mode:"legacy"|"clinical"="legacy")=>renderToStaticMarkup(<CatatanForm mode={mode} recordId="stay" requestKey="k" draftUserId="u" backHref="/b" petHotel={petHotel}
 patient={{name:'DEMO',species:'Kucing',breed:null,noRM:'R/1',owner:'DEMO Owner',phone:'0800',address:'-',tglMasuk:'-',dokter:'Drh DEMO',kondisi:'Stabil',photo:null}}
 items={[]} racikanItems={[]} bahanItems={[]} jasaItems={[]} tindakanItems={[]} katalogRacikan={[]} bolehManual={false}
 doctors={[{id:'d1',nama:'Drh DEMO',jabatan:'Dokter'}]} paramedics={[{id:'p1',nama:'DEMO Paramedis',jabatan:'Paramedis'}]}/>);

it('K14 pet hotel log asks for food, condition and a free note by a paramedic; no doctor or temperature',()=>{
 const html=render(true);
 for(const field of ['name="makan"','name="condition_note"','name="keterangan"','Paramedis yang mencatat'])expect(html).toContain(field);
 expect(html).toMatch(/<select[^>]*name="paramedic_id"[^>]*required/);
 for(const field of ['name="suhu"','name="berat"','name="visit_doctor_id"','name="tindakan"'])expect(html).not.toContain(field);
});
it('new clinical pet hotel keeps paramedic monitoring, not Visit labels',()=>{
 const html=render(true,'clinical');
 expect(html).toContain('name="log_kind" value="monitoring"');
 expect(html).toMatch(/<select[^>]*name="paramedic_id"[^>]*required/);
 expect(html).not.toContain('name="visit_label"');expect(html).not.toContain('name="visit_doctor_id"');
});
it.each(['monitoring','doctor_visit',null] as const)('legacy staff fields keep saved %s semantics and correction locks',kind=>{
 const html=renderToStaticMarkup(<InpatientStaffFields value={{log_kind:kind,visit_doctor_id:kind==='doctor_visit'?'saved-doctor':null,paramedic_id:null}} onChange={()=>{}} doctors={[]} paramedics={[]} lockVisit savedKind={kind}/>);
 expect(html).toContain('aria-label="Jenis laporan"');expect(html).not.toContain('name="visit_label"');
 if(kind==='doctor_visit'){expect(html).toMatch(/<select[^>]*disabled=""[^>]*aria-label="Jenis laporan"/);expect(html).toContain('name="visit_doctor_id" value="saved-doctor"');}
 else {expect(html).not.toContain('<option value="doctor_visit"');expect(html).toContain('<option value="monitoring"');}
});
it('K14 sick inpatient log keeps the full clinical form',()=>{
 const html=render(false);
 for(const field of ['name="suhu"','name="berat"','name="visit_doctor_id"','name="tindakan"','name="minum"'])expect(html).toContain(field);
});
