-- S04 ROLLBACK — WRITES. Hanya bila diputuskan mundur SEBELUM ada penggajian yang memakai kebijakan ini.
-- Menghapus tabel kebijakan; aplikasi otomatis kembali ke perilaku lama (baris dua pelaksana tertahan
-- "perlu keputusan" dan memblokir penggajian). Tidak ada kode aplikasi yang perlu di-revert.
--
-- PENGAMAN: rollback DITOLAK (tanpa perubahan apa pun) bila tabel berisi baris selain satu baris kebijakan
-- yang ditanam apply.sql (semua cabang, 2026-11-01, personal_rules) — artinya sudah ada pilihan baru dari layar
-- Komisi yang ikut terhapus. Alternatif yang lebih aman: simpan kebijakan baru "Ditahan" dari layar Komisi.
-- Hanya bila OWNER sudah memutuskan semua baris boleh dihapus, aktifkan baris set_config di bawah ini.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- select set_config('kamo.s04_rollback_confirm', 'HAPUS-SEMUA-KEBIJAKAN', true);
do $$
declare v_other bigint;
begin
  if to_regclass('public.service_commission_policies') is null then
    return;
  end if;
  execute $q$
    select count(*) from public.service_commission_policies p
    where not (p.branch_id is null and p.effective_from = date '2026-11-01' and p.mode = 'personal_rules'
               and p.doctor_share_pct is null and p.staff_share_pct is null)
       or p.id <> (select s.id from public.service_commission_policies s
                   where s.branch_id is null and s.effective_from = date '2026-11-01' and s.mode = 'personal_rules'
                   order by s.created_at, s.id limit 1)
  $q$ into v_other;
  if v_other > 0 and coalesce(current_setting('kamo.s04_rollback_confirm', true), '') <> 'HAPUS-SEMUA-KEBIJAKAN' then
    raise exception 'S04 rollback ditolak: ada % baris kebijakan selain baris yang ditanam apply.sql. Tidak ada yang dihapus. Lihat catatan di kepala file.', v_other;
  end if;
end $$;
drop table if exists public.service_commission_policies;
delete from supabase_migrations.schema_migrations where version = '20261026002000';
commit;
