import { expect, it } from 'vitest';
import { cabangDiizinkan, karyawanCabang } from '../jadwal-scope-rules';
it('owner sees all, admin only assigned active branches, never future assignment', () => {
 const branches = [{id:'a'},{id:'b'}]; const assignments = [{branch_id:'a',effective_date:'2026-09-01'},{branch_id:'b',effective_date:'2026-11-01'}];
 expect(cabangDiizinkan('ADMIN',branches,assignments,'2026-10-01').map(b=>b.id)).toEqual(['a']);
 expect(cabangDiizinkan('OWNER',branches,[],'2026-10-01')).toEqual(branches);
 expect(cabangDiizinkan('ADMIN',branches,[],'2026-10-01')).toEqual([]);
});
it('requires positive assignments and does not bypass future or other-branch assignments', () => {
 const employees = [{id:'e1',branch_id:'a'},{id:'e2',branch_id:'a'},{id:'e3',branch_id:'a'}];
 const assignments = [{employee_id:'e1',branch_id:'a',effective_date:'2026-09-01'},{employee_id:'e2',branch_id:'b',effective_date:'2026-09-01'},{employee_id:'e3',branch_id:'a',effective_date:'2026-11-01'}];
 expect(karyawanCabang(employees,assignments,'a','2026-10-01').map(e=>e.id)).toEqual(['e1']);
});
it('does not infer schedule authorization when RLS hides assignments', () => {
 expect(karyawanCabang([{id:'e1',branch_id:'a'}],[],'a','2026-10-01')).toEqual([]);
});
