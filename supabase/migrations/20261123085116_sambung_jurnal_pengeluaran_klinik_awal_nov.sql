-- 13 pengeluaran klinik 1-2 Nov 2026 punya jurnal (source='expense', source_ref=id, nominal & akun benar)
-- tetapi expenses.journal_entry_id kosong. Hanya menyambung tautan; tidak membuat/mengubah jurnal atau angka.
do $sambung$
declare n integer;
begin
 with kandidat as (
   select e.id, (select j.id from public.journal_entries j where j.source='expense' and j.source_ref=e.id::text) jid,
          (select count(*) from public.journal_entries j where j.source='expense' and j.source_ref=e.id::text) jml
   from public.expenses e where e.journal_entry_id is null and e.voided_at is null
 ), cocok as (
   select k.id, k.jid from kandidat k
   where k.jml=1 and (select sum(l.debit) from public.journal_lines l where l.entry_id=k.jid)=(select jumlah from public.expenses where id=k.id)
 )
 update public.expenses e set journal_entry_id=c.jid from cocok c where e.id=c.id;
 get diagnostics n=row_count;
 if n<>13 then raise exception 'Diharapkan 13 pengeluaran disambungkan, didapat %', n; end if;
 if exists(select 1 from public.expenses e where e.journal_entry_id is null and e.voided_at is null) then
   raise exception 'Masih ada pengeluaran aktif tanpa tautan jurnal'; end if;
end $sambung$;
