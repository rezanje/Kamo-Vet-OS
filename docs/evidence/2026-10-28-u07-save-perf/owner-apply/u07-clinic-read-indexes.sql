-- U07 INDEX BACA KLINIK — paket owner (opsional, aman).
-- Isi: 4 index baca. Tidak mengubah data, hak akses, atau fungsi. Tabel saat ini kecil
-- (puluhan baris), jadi pembuatan index selesai dalam hitungan detik tanpa mengunci lama.
-- Kode di PR U07 TIDAK bergantung pada index ini: aplikasi tetap jalan sebelum/sesudah.
-- Jalankan di Supabase SQL editor sebagai postgres, per langkah.

-- 1) PREFLIGHT (read only) — semua baris "exists" harus false sebelum apply.
select i.name, to_regclass('public.' || i.name) is not null as exists
from (values ('visit_referrals_visit_id_idx'), ('visits_customer_branch_created_idx'),
             ('visits_pet_id_idx'), ('follow_ups_visit_id_idx')) as i(name);

-- 2) APPLY — sama persis dengan supabase/migrations/20261028090000_u07_clinic_read_indexes.sql
begin;
create index if not exists visit_referrals_visit_id_idx
  on public.visit_referrals (visit_id, referred_at desc);
create index if not exists visits_customer_branch_created_idx
  on public.visits (customer_id, branch_id, created_at);
create index if not exists visits_pet_id_idx
  on public.visits (pet_id);
create index if not exists follow_ups_visit_id_idx
  on public.follow_ups (visit_id);
insert into supabase_migrations.schema_migrations (version, name)
select '20261028090000', 'u07_clinic_read_indexes'
where not exists (select 1 from supabase_migrations.schema_migrations where version = '20261028090000');
commit;

-- 3) READBACK (read only) — harus 4 baris, semua exists = true, plus 1 baris riwayat migrasi.
select i.name, to_regclass('public.' || i.name) is not null as exists
from (values ('visit_referrals_visit_id_idx'), ('visits_customer_branch_created_idx'),
             ('visits_pet_id_idx'), ('follow_ups_visit_id_idx')) as i(name);
select version, name from supabase_migrations.schema_migrations where version = '20261028090000';

-- 4) ROLLBACK (hanya bila diminta) — menghapus index saja, tidak menyentuh data.
-- begin;
-- drop index if exists public.visit_referrals_visit_id_idx;
-- drop index if exists public.visits_customer_branch_created_idx;
-- drop index if exists public.visits_pet_id_idx;
-- drop index if exists public.follow_ups_visit_id_idx;
-- delete from supabase_migrations.schema_migrations where version = '20261028090000';
-- commit;
