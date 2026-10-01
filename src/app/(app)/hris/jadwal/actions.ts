"use server";
import { redirect } from 'next/navigation';
import { assertRole } from '@/lib/master-guard';
import { hariPeriode, tanggalValid } from '@/lib/jadwal-kalender';
import { validasiJadwal } from '@/lib/jadwal-excel';
import { scopeJadwal } from '@/lib/jadwal-scope';

async function simpan(form:FormData, impor:boolean) {
  const cabang = String(form.get('cabang')??'');
  const bulan = String(form.get('bulan')??'');
  const minggu = String(form.get('minggu')??'');
  const kembali = `/hris/jadwal?${new URLSearchParams({cabang,bulan,...(minggu?{minggu}:{})})}`;
  const supabase = await assertRole(kembali,'jadwal shift',['OWNER','ADMIN']);
  let message = '', jumlah = 0;
  try {
    if(!tanggalValid(`${bulan}-01`) || (minggu && !tanggalValid(minggu))) throw new Error('Periode tidak valid.');
    const hari = hariPeriode(bulan,minggu||undefined);
    const scope = await scopeJadwal(supabase,cabang,hari[0].tanggal,hari.at(-1)!.tanggal);
    const raw = String(form.get('rows')??'[]');
    if(raw.length>3_000_000) throw new Error('Perubahan terlalu besar. Maksimal 10.000 sel.');
    const parsed: unknown = JSON.parse(raw);
    const hasil = validasiJadwal(parsed,{...scope,shifts:scope.shifts.filter(s=>s.is_active).map(s=>s.id)},impor);
    if(hasil.errors.length) throw new Error(hasil.errors.slice(0,4).join('; '));
    if(impor && form.get('konfirmasi')!=='1') throw new Error('Konfirmasikan preview sebelum menyimpan.');
    if(impor) {
      // One insert is atomic. Unique(employee_id,tanggal) prevents races from
      // overwriting existing schedules; never use upsert for imported rows.
      if(hasil.rows.length) {
        const {error} = await supabase.from('employee_schedules').insert(hasil.rows.map(r=>({employee_id:r.employee_id,tanggal:r.tanggal,shift_id:r.shift_id,created_by:scope.user.id})));
        if(error) throw new Error('Impor gagal. Jadwal mungkin telah berubah; muat ulang dan preview kembali. Tidak ada baris impor disimpan.');
      }
    } else {
      for(const r of hasil.rows.filter(r=>!r.shift_id)) {
        const {data,error} = await supabase.from('employee_schedules').delete().eq('employee_id',r.employee_id).eq('tanggal',r.tanggal).select('id');
        if(error || !data?.length) throw new Error('Jadwal tidak terhapus atau akses berubah. Muat ulang papan jadwal.');
      }
      const filled = hasil.rows.filter(r=>r.shift_id);
      if(filled.length) {
        const {error} = await supabase.from('employee_schedules').upsert(filled.map(r=>({employee_id:r.employee_id,tanggal:r.tanggal,shift_id:r.shift_id,created_by:scope.user.id})),{onConflict:'employee_id,tanggal'});
        if(error) throw new Error('Sebagian perubahan belum tersimpan. Muat ulang papan jadwal.');
      }
    }
    jumlah = hasil.rows.length;
  } catch(e) { message = e instanceof Error ? e.message : 'Jadwal gagal disimpan.'; }
  redirect(`${kembali}&${message?`error=${encodeURIComponent(message)}`:`success=${jumlah}`}`);
}
export async function simpanJadwal(form:FormData) { return simpan(form,false); }
export async function imporJadwal(form:FormData) { return simpan(form,true); }
