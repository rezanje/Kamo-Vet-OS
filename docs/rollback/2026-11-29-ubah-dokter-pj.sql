-- ROLLBACK migrasi 20261129100000_ubah_dokter_pj.sql
-- Mengembalikan pagar rawat inap ke teks sebelum kandidat, menghapus fungsi/izin transaksi/izin Akses Grup yang baru.
-- TIDAK menghapus jejak audit (public.visit_doctor_changes tetap sebagai arsip, tetap tak dapat diubah) dan TIDAK
-- mengembalikan dokter kunjungan yang sudah dikoreksi (itu data bisnis; mengembalikannya = koreksi baru).
begin;

do $rb$
declare
  d text; n integer;
  new_t constant text := $n$if new.doctor_id is distinct from old.doctor_id or new.doctor_name is distinct from old.doctor_name$n$;
  old_t constant text := $o$if ((new.doctor_id is distinct from old.doctor_id or new.doctor_name is distinct from old.doctor_name) and not exists (select 1 from clinic_private.visit_doctor_change_permits p where p.transaction_id = txid_current() and p.actor = auth.uid() and p.visit_id = old.visit_id))$o$;
begin
  d := pg_get_functiondef('public.protect_inpatient_care_staff()'::regprocedure);
  n := (length(d) - length(replace(d, old_t, ''))) / length(old_t);
  if n <> 1 then
    raise exception 'ROLLBACK_UBAH_DOKTER: tambalan pagar ditemukan % kali (harus 1); tidak ada yang diubah', n;
  end if;
  execute replace(d, old_t, new_t);
end $rb$;

drop function public.clinic_change_visit_doctor(uuid, uuid, text, text, boolean, boolean);
drop function public.clinic_visit_doctor_change_allowed();
drop function clinic_private.visit_doctor_change_actor();
drop table clinic_private.visit_doctor_change_permits;

alter table role_settings_private.epochs disable trigger epoch_guard;
alter table role_settings_private.action_policies disable trigger action_policy_guard;
update role_settings_private.action_policies set allowed = array_remove(allowed, 'klinik.ubah_dokter_pj')
 where 'klinik.ubah_dokter_pj' = any (allowed);
delete from role_settings_private.action_modules where id = 'klinik.ubah_dokter_pj';
delete from role_settings_private.action_catalog where id = 'klinik.ubah_dokter_pj';
alter table role_settings_private.action_policies enable trigger action_policy_guard;
alter table role_settings_private.epochs enable trigger epoch_guard;

commit;
