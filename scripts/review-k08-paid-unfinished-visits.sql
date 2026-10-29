-- K08: kunjungan klinik yang invoicenya sudah LUNAS tetapi status kunjungannya belum "Selesai".
-- Sejak migrasi 20261022232107 pembuatan invoice lunas langsung menyelesaikan kunjungan dalam
-- transaksi yang sama, jadi kasus ini hanya sisa data lama. Layar pembayaran hanya memberi
-- peringatan; perbaikan otomatis dari aplikasi dibatalkan karena berpacu dengan "masuk rawat inap"
-- (kunjungan lunas yang belum selesai masih bisa di-admit langsung).
--
-- Skrip ini TIDAK menyentuh uang: tidak ada invoice, pembayaran, jurnal, stok, poin atau komisi
-- yang diubah. Perbaikan hanya menandai kunjungan selesai (status Selesai + jam checkout) dan
-- mencatat satu event check_out, persis efek set_visit_service_state(.., 'checkout').
--
-- Pemakaian (pemeliharaan ber-hak penuh saja, setelah backup + persetujuan pemilik):
--   1) Pratinjau, read-only (default), tidak mengubah apa pun:
--        psql "<koneksi>" -v ON_ERROR_STOP=1 -f scripts/review-k08-paid-unfinished-visits.sql
--   2) Perbaikan terjaga: hanya baris kategori 'aman_diperbaiki'; jumlahnya harus sama persis
--      dengan angka pratinjau yang sudah ditinjau, kalau tidak seluruh transaksi dibatalkan:
--        psql "<koneksi>" -v ON_ERROR_STOP=1 -v apply=1 -v expected=<jumlah> \
--          -v actor=<id profil OWNER yang menyetujui> -f scripts/review-k08-paid-unfinished-visits.sql
--      Event check_out dicatat atas nama OWNER tersebut (kolom pencatat wajib diisi).
-- Kategori 'perlu_tinjau' (rawat inap masih aktif, koreksi tagihan tertunda, invoice tanpa nomor,
-- lebih dari satu invoice aktif) tidak pernah diubah oleh skrip ini.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?expected}
\else
  \set expected -1
\endif
\if :{?actor}
\else
  \set actor ''
\endif

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select set_config('k08.expected', :'expected', true), set_config('k08.actor', :'actor', true);

create temporary view k08_paid_unfinished as
select v.id as visit_id, v.branch_id, b.name as cabang, v.status::text as status_kunjungan,
  v.checked_out_at, v.created_at as tanggal_kunjungan,
  i.id as invoice_id, i.invoice_no, i.total, i.paid_at, i.correction_pending,
  (select count(*) from public.invoices x where x.visit_id = v.id and x.voided_at is null) as invoice_aktif,
  exists(select 1 from public.inpatient_records r
         where r.visit_id = v.id and r.discharged_at is null) as rawat_inap_aktif,
  case
    when exists(select 1 from public.inpatient_records r
                where r.visit_id = v.id and r.discharged_at is null) then 'perlu_tinjau: rawat inap masih aktif'
    when i.correction_pending then 'perlu_tinjau: koreksi tagihan tertunda'
    when i.invoice_no is null then 'perlu_tinjau: invoice tanpa nomor'
    when (select count(*) from public.invoices x where x.visit_id = v.id and x.voided_at is null) <> 1
      then 'perlu_tinjau: lebih dari satu invoice aktif'
    else 'aman_diperbaiki'
  end as kategori
from public.visits v
join public.invoices i on i.visit_id = v.id and i.voided_at is null and i.paid_status = 'Lunas'
left join public.branches b on b.id = v.branch_id
where v.status::text <> 'Selesai';

-- Preview mode: from here on nothing can be written (the temporary view is discarded on rollback).
\if :apply
\else
set transaction read only;
\endif

\echo '== Ringkasan kunjungan lunas tetapi belum selesai =='
select kategori, count(*) as jumlah from k08_paid_unfinished group by kategori order by kategori;
\echo '== Rincian =='
select kategori, cabang, tanggal_kunjungan, status_kunjungan, invoice_no, total, paid_at, visit_id
from k08_paid_unfinished order by kategori, tanggal_kunjungan, visit_id;

\if :apply
do $repair$
declare
  v_expected integer := nullif(current_setting('k08.expected', true), '')::integer;
  v_row record;
  v_visit public.visits%rowtype;
  v_actor uuid := nullif(current_setting('k08.actor', true), '')::uuid;
  v_done integer := 0;
begin
  if v_expected is null or v_expected < 0 then
    raise exception 'K08 repair: isi -v expected=<jumlah aman_diperbaiki dari pratinjau>';
  end if;
  if v_actor is null or not exists(select 1 from public.profiles p
      where p.id = v_actor and p.role = 'OWNER' and p.is_active) then
    raise exception 'K08 repair: isi -v actor=<id profil OWNER aktif yang menyetujui>';
  end if;
  for v_row in
    select visit_id, invoice_id, invoice_no, paid_at from k08_paid_unfinished
    where kategori = 'aman_diperbaiki' order by visit_id
  loop
    -- Same lock as admission/posting/payment: the visit row. Re-check under the lock so a
    -- concurrent admission or correction is never overridden.
    select * into v_visit from public.visits where id = v_row.visit_id for update;
    if v_visit.status::text = 'Selesai'
       or exists(select 1 from public.inpatient_records r
                 where r.visit_id = v_visit.id and r.discharged_at is null)
       or not exists(select 1 from public.invoices i where i.id = v_row.invoice_id
                     and i.voided_at is null and i.paid_status = 'Lunas' and not i.correction_pending)
       or (select count(*) from public.invoices i where i.visit_id = v_visit.id and i.voided_at is null) <> 1 then
      raise exception 'K08 repair: kunjungan % berubah sejak pratinjau; jalankan pratinjau lagi', v_visit.id;
    end if;
    update public.visits
      set status = 'Selesai', checked_out_at = coalesce(checked_out_at, v_row.paid_at, now())
      where id = v_visit.id;
    insert into public.visit_operational_events(visit_id, branch_id, event_type, payload, created_by)
    values (v_visit.id, v_visit.branch_id, 'check_out',
      jsonb_build_object('source', 'k08-paid-unfinished-repair',
        'invoice_id', v_row.invoice_id, 'invoice_no', v_row.invoice_no), v_actor);
    v_done := v_done + 1;
  end loop;
  if v_done <> v_expected then
    raise exception 'K08 repair: % kunjungan siap diperbaiki, pratinjau yang ditinjau menyebut %; dibatalkan',
      v_done, v_expected;
  end if;
  raise notice 'K08 repair: % kunjungan ditandai selesai (tanpa perubahan uang)', v_done;
end
$repair$;
\echo '== Sisa setelah perbaikan (harus hanya perlu_tinjau) =='
select kategori, count(*) as jumlah from k08_paid_unfinished group by kategori order by kategori;
commit;
\else
\echo '== Pratinjau saja: tidak ada perubahan. Jalankan dengan -v apply=1 -v expected=<jumlah> setelah ditinjau. =='
rollback;
\endif
