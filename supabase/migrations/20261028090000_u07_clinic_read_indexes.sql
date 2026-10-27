-- U07 performa simpan/proses klinik: index baca untuk kolom yang difilter di
-- halaman rekam medis & riwayat pasien tapi belum punya index (Supabase
-- performance advisor: unindexed_foreign_keys). Data saat ini kecil, jadi ini
-- pencegahan agar halaman tidak melambat seiring kunjungan bertambah.
-- Hanya menambah index: tidak mengubah data, hak akses, atau perilaku.
create index if not exists visit_referrals_visit_id_idx
  on public.visit_referrals (visit_id, referred_at desc);
-- Tab "satu pemilik bawa beberapa hewan" (bacaSaudaraKunjungan) memfilter
-- customer_id + branch_id + rentang created_at di setiap buka rekam medis.
create index if not exists visits_customer_branch_created_idx
  on public.visits (customer_id, branch_id, created_at);
create index if not exists visits_pet_id_idx
  on public.visits (pet_id);
create index if not exists follow_ups_visit_id_idx
  on public.follow_ups (visit_id);
