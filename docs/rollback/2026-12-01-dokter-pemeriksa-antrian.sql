-- ROLLBACK migrasi 20261201200000_dokter_pemeriksa_antrian.sql
-- Mencabut dua trigger + fungsi pagar + indeks. Kolom public.visits.pemeriksa_id DIPERTAHANKAN (isinya data bisnis: dokter yang dipilih
-- saat pendaftaran; aplikasi lama mengabaikannya). Bila kolom benar-benar harus dihapus, jalankan baris terakhir (komentar) secara sadar.
begin;
drop trigger if exists master_ref_employees_pemeriksa_id on public.visits;
drop trigger if exists b2_guard_visit_pemeriksa on public.visits;
drop function if exists clinic_private.guard_visit_pemeriksa();
drop index if exists public.visits_pemeriksa_id_idx;
commit;
-- alter table public.visits drop column pemeriksa_id;
