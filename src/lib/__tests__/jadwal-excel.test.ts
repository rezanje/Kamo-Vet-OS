import { describe, it, expect } from 'vitest';
import { hariPeriode } from '../jadwal-kalender';
import { validasiJadwal, buatExcelJadwal, bacaExcelJadwal } from '../jadwal-excel';
const row = { employee_id: 'e1', tanggal: '2026-10-01', shift_id: 's1', branch_id: 'b1' };
const scope = { cabang: 'b1', awal: '2026-09-28', akhir: '2026-10-04', employees: ['e1'], shifts: ['s1'], existing: {} as Record<string,string> };
describe('jadwal', () => {
 it('week starts Monday and spans month boundary', () => { const days = hariPeriode('2026-10', '2026-10-01'); expect(days.map(d => d.tanggal)).toEqual(['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04']); });
 it.each([{employee_id:'unknown'},{shift_id:'unknown'},{branch_id:'b2'},{tanggal:'2026-02-30'},{tanggal:'2026-10-05'}])('rejects invalid/cross-branch rows %j before any write', patch => { expect(validasiJadwal([row,{...row,...patch}],scope).rows).toEqual([]); expect(validasiJadwal([row,{...row,...patch}],scope).errors.length).toBeGreaterThan(0); });
 it('rejects duplicate employee/date', () => { expect(validasiJadwal([row,row],scope).rows).toEqual([]); });
 it('skips unchanged rows and rejects overwriting existing cells', () => { const existing = {'e1|2026-10-01':'s1'}; expect(validasiJadwal([row], {...scope,existing}).skipped).toBe(1); expect(validasiJadwal([row], {...scope,existing:{'e1|2026-10-01':'s2'}}).errors.length).toBe(1); });
 it('rejects malformed payloads', () => { for(const value of [null,{},[null],[{}]]) expect(validasiJadwal(value,scope).errors.length).toBeGreaterThan(0); });
 it('exports and imports real Excel without losing identifiers or dates', async () => { const bytes = await buatExcelJadwal([row]); const result = await bacaExcelJadwal(bytes); expect(result.errors).toEqual([]); expect(result.rows).toEqual([row]); expect(validasiJadwal(result.rows,scope).rows).toEqual([row]); });
});
it('validates each day of a mid-period employee assignment',()=>{
 const employeeStarts={'e1':'2026-10-01'};
 expect(validasiJadwal([row],{...scope,employeeStarts}).errors).toEqual([]);
 expect(validasiJadwal([{...row,tanggal:'2026-09-30'}],{...scope,employeeStarts}).rows).toEqual([]);
});
it('round-trips a month of 17 employees (527 schedules)',async()=>{
 const rows=Array.from({length:527},(_,i)=>({...row,employee_id:`e${Math.floor(i/31)}`,tanggal:`2026-10-${String(i%31+1).padStart(2,'0')}`}));
 const bytes=await buatExcelJadwal(rows);const parsed=await bacaExcelJadwal(bytes);
 expect(parsed.errors).toEqual([]);
 expect(validasiJadwal(parsed.rows,{...scope,awal:'2026-10-01',akhir:'2026-10-31',employees:Array.from({length:17},(_,i)=>`e${i}`)}).rows).toHaveLength(527);
});
it('skips exact stored inactive shift but rejects a new assignment to it',()=>{
 const inactive={...row,shift_id:'inactive'};
 expect(validasiJadwal([inactive],{...scope,existing:{'e1|2026-10-01':'inactive'}})).toMatchObject({rows:[],errors:[],skipped:1});
 expect(validasiJadwal([inactive],scope).errors.length).toBe(1);
});
