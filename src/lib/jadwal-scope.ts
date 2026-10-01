import { createClient } from './supabase/server';
import { hariIniWIB } from './tanggal';
import { cabangDiizinkan, karyawanCabang } from './jadwal-scope-rules';
export async function aksesCabangHRIS(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {data:{user},error:authError} = await supabase.auth.getUser();
  if(authError || !user) throw new Error('Silakan login kembali.');
  const [profile,branches,assignments] = await Promise.all([
    supabase.from('profiles').select('role').eq('id',user.id).maybeSingle(),
    supabase.from('branches').select('id, name').eq('is_active',true).order('name'),
    supabase.from('user_branches').select('branch_id, effective_date').eq('user_id',user.id),
  ]);
  if(profile.error || !profile.data || branches.error || assignments.error) throw new Error('Hak akses cabang gagal dimuat.');
  return {user,role:profile.data.role as string,branches:cabangDiizinkan(profile.data.role, branches.data??[], assignments.data??[],hariIniWIB())};
}
export async function scopeJadwal(supabase: Awaited<ReturnType<typeof createClient>>, cabang:string, awal:string, akhir:string) {
  const access = await aksesCabangHRIS(supabase);
  if(!access.branches.some(b=>b.id===cabang)) throw new Error('Cabang tidak diizinkan.');
  const [employees,shifts,assignments] = await Promise.all([
    supabase.from('employees').select('id, nama, jabatan, branch_id').eq('status','Aktif').order('nama'),
    supabase.from('work_shifts').select('id, nama, warna, is_libur, jam_masuk, jam_pulang, branch_id, is_active').or(`branch_id.is.null,branch_id.eq.${cabang}`).order('jam_masuk'),
    supabase.from('employee_branch_assignments').select('employee_id, branch_id, effective_date'),
  ]);
  if(employees.error || shifts.error || assignments.error) throw new Error('Data jadwal gagal dimuat. Tidak ada perubahan disimpan.');
  // Require positive assignment evidence: RLS can hide other branch assignments.
  const karyawan = karyawanCabang(employees.data??[],assignments.data??[],cabang,akhir);
  const employeeStarts: Record<string,string> = {};
  for (const a of assignments.data ?? []) {
    if (a.branch_id !== cabang || !karyawan.some(e=>e.id===a.employee_id)) continue;
    const old = employeeStarts[a.employee_id];
    if (!old || a.effective_date < old) employeeStarts[a.employee_id] = a.effective_date;
  }
  const existing: Record<string,string> = {};
  if (karyawan.length) {
    for (let offset = 0; ; offset += 1000) {
      const schedules = await supabase.from('employee_schedules').select('employee_id, tanggal, shift_id')
        .in('employee_id',karyawan.map(e=>e.id)).gte('tanggal',awal).lte('tanggal',akhir)
        .order('employee_id').order('tanggal').range(offset,offset+999);
      if(schedules.error) throw new Error('Jadwal tersimpan gagal dimuat.');
      schedules.data?.forEach(r=>{existing[`${r.employee_id}|${r.tanggal}`]=r.shift_id;});
      if ((schedules.data?.length ?? 0) < 1000) break;
    }
  }
  return {...access,karyawan,shifts:shifts.data??[],existing,employeeStarts,cabang,awal,akhir,employees:karyawan.map(e=>e.id)};
}
