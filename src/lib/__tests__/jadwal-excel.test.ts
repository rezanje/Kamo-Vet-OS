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
