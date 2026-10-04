export function cabangDiizinkan<T extends {id:string}>(role:string, branches:T[], assignments:{branch_id:string;effective_date:string}[], today:string): T[] {
  const ids = new Set(assignments.filter(a=>a.effective_date<=today).map(a=>a.branch_id));
  return branches.filter(b=>role==='OWNER' || ids.has(b.id));
}
export function karyawanCabang<T extends {id:string;branch_id:string|null}>(employees:T[], assignments:{employee_id:string;branch_id:string;effective_date:string}[], cabang:string, tanggal:string): T[] {
  return employees.filter(e => {
    const own = assignments.filter(a=>a.employee_id===e.id);
    return own.some(a=>a.branch_id===cabang && a.effective_date<=tanggal);
  });
}
