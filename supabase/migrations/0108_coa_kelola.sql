-- Bagan Akun bisa dikelola dari layar, dengan pengaman di database.
--
-- Sampai sekarang coa_accounts read-only di aplikasi tapi policy-nya
-- `for all using (true)` — artinya siapa pun yang login (termasuk STAFF) bisa
-- menambah/mengubah/menghapus akun lewat API, walau layarnya tidak menyediakan.
-- Begitu layarnya dibuka, lubang itu harus ditutup lebih dulu.

-- 1. Baca tetap terbuka: seluruh laporan & dropdown butuh daftar akun.
drop policy if exists coa_all on coa_accounts;
create policy coa_read on coa_accounts for select to authenticated using (true);

-- 2. Tulis hanya OWNER/ADMIN. Dijaga di database, bukan cuma di server action —
--    kalau cuma di aplikasi, siapa pun yang pegang kunci anon bisa memakai API.
--    DELETE sengaja ikut diizinkan (bukan dilarang total) karena pembuatan
--    rekening kas/bank memakai delete untuk membatalkan akun yatim saat langkah
--    berikutnya gagal (lihat kas-bank/rekening/actions.ts).
create policy coa_write on coa_accounts for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER', 'ADMIN')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER', 'ADMIN')));

-- 3. Rem terakhir untuk nilai yang mematikan laporan kalau salah.
--    Tabelnya sejak awal tidak punya CHECK sama sekali, jadi salah ketik "BIAYA"
--    membuat akunnya hilang dari SELURUH laporan tanpa pesan apa pun: lib/ledger
--    mengelompokkan lewat `type`, dan tipe asing tidak masuk kelompok mana pun.
alter table coa_accounts drop constraint if exists coa_accounts_type_check;
alter table coa_accounts add constraint coa_accounts_type_check
  check (type in ('ASET', 'LIABILITAS', 'EKUITAS', 'PENDAPATAN', 'BEBAN'));

alter table coa_accounts drop constraint if exists coa_accounts_normal_check;
alter table coa_accounts add constraint coa_accounts_normal_check
  check (normal_balance in ('D', 'K'));

-- Akun kontra (saldo berlawanan dengan kelompoknya) hanya masuk akal di neraca —
-- 1509 Akumulasi Penyusutan contohnya, dan lib/ledger → nilaiSeksi sudah
-- menanganinya. Untuk PENDAPATAN & BEBAN tidak boleh: Laba Rugi, dashboard, dan
-- jurnal penutup membaca saldo mentah, jadi saldo terbalik di dua kelompok itu
-- menggandakan angkanya saat tutup buku.
alter table coa_accounts drop constraint if exists coa_accounts_laba_rugi_normal_check;
alter table coa_accounts add constraint coa_accounts_laba_rugi_normal_check
  check (
    (type = 'PENDAPATAN' and normal_balance = 'K')
    or (type = 'BEBAN' and normal_balance = 'D')
    or type in ('ASET', 'LIABILITAS', 'EKUITAS')
  );

comment on table coa_accounts is
  'Bagan akun. Kode dipakai KERAS oleh jalur jurnal (lihat lib/coa-sistem → KODE_SISTEM): kode yang hilang membuat postJournal berhenti diam-diam.';
