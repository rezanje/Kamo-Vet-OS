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
    supabase.from('work_shifts').select('id, nama, warna, is_libur, jam_masuk, jam_pulang, branch_id').eq('is_active',true).or(`branch_id.is.null,branch_id.eq.${cabang}`).order('jam_masuk'),
    supabase.from('employee_branch_assignments').select('employee_id, branch_id, effective_date'),
  ]);
  if(employees.error || shifts.error || assignments.error) throw new Error('Data jadwal gagal dimuat. Tidak ada perubahan disimpan.');
  // Require positive assignment evidence: RLS can hide other branch assignments.
  const karyawan = karyawanCabang(employees.data??[],assignments.data??[],cabang,awal);
  const schedules = karyawan.length ? await supabase.from('employee_schedules').select('employee_id, tanggal, shift_id').in('employee_id',karyawan.map(e=>e.id)).gte('tanggal',awal).lte('tanggal',akhir) : {data:[],error:null};
  if(schedules.error) throw new Error('Jadwal tersimpan gagal dimuat.');
  const existing: Record<string,string> = {};
  schedules.data?.forEach(r=>{existing[`${r.employee_id}|${r.tanggal}`]=r.shift_id;});
  return {...access,karyawan,shifts:shifts.data??[],existing,cabang,awal,akhir,employees:karyawan.map(e=>e.id)};
}
