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
      jumlah = hasil.rows.length;
    } else {
      // Keep the browser's original cell versions: a fresh server snapshot must
      // never make a stale browser edit appear current.
      const {data,error} = await supabase.rpc('hris_save_schedule_batch',{
        p_branch:cabang,p_start:hari[0].tanggal,p_end:hari.at(-1)!.tanggal,p_rows:hasil.rows,
      });
      if(error) throw new Error(error.message?.startsWith('JADWAL:')
        ? `${error.message.slice(7).trim()}. Tidak ada perubahan disimpan.`
        : 'Jadwal gagal disimpan. Muat ulang papan jadwal. Tidak ada perubahan disimpan.');
      if(!data || !Number.isInteger(data.jumlah) || data.jumlah < 0 || data.jumlah > hasil.rows.length)
        throw new Error('Hasil penyimpanan tidak dapat dikonfirmasi. Muat ulang papan jadwal.');
      jumlah = data.jumlah;
    }
  } catch(e) { message = e instanceof Error ? e.message : 'Jadwal gagal disimpan.'; }
  redirect(`${kembali}&${message?`error=${encodeURIComponent(message)}`:`success=${jumlah}`}`);
}
export async function simpanJadwal(form:FormData) { return simpan(form,false); }
export async function imporJadwal(form:FormData) { return simpan(form,true); }
