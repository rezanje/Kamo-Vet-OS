-- Cabang sejak migrasi 0002 cuma punya policy SELECT — tidak ada satu pun jalan
-- untuk mengubahnya dari aplikasi. Titik lokasi absen (0087) butuh UPDATE.
-- Guard peran (OWNER/ADMIN) ada di server action, pola cash_accounts (0068).
create policy branches_update on branches for update to authenticated using (true) with check (true);
