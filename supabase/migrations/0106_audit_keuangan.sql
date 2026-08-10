-- Perbaikan hasil audit keuangan 2026-08-10.
--
-- 1. Kunci anti-jurnal-dobel untuk dokumen yang WAJIB dijurnal tepat sekali.
--    Tidak semua source boleh kena aturan ini:
--      - 'klinik-ar'  : satu invoice bisa dicicil berkali-kali (satu jurnal per cicilan)
--      - 'klinik-edit': satu invoice menghasilkan pasangan pembalikan + posting ulang
--      - 'depreciation': aset baru yang ditambah belakangan menyusul periode yang sama
--    Makanya indeksnya PARSIAL dengan daftar putih, bukan unique polos.
create unique index if not exists journal_entries_sekali_saja
  on journal_entries (source, source_ref)
  where source_ref is not null and source in (
    'sale', 'sale-hpp', 'sale-online', 'klinik', 'klinik-hpp', 'klinik-void',
    'purchase', 'purchase-return', 'sales-return', 'sales-return-hpp',
    'transfer', 'transfer-void', 'kas-entry', 'kas-entry-void',
    'payroll', 'kasbon', 'recurring', 'cash-account-opening', 'closing', 'saldo-awal'
  );

-- 2. Akumulasi Penyusutan adalah KONTRA-ASET: saldo normalnya kredit, bukan debit.
--    Sebelumnya diberi 'D' supaya aritmetika neraca kebetulan pas; sekarang laporan
--    yang menanganinya (lihat lib/ledger → nilaiNeraca), jadi masternya boleh benar.
update coa_accounts set normal_balance = 'K' where code = '1509' and type = 'ASET';

-- 3. Saldo awal memakai 3101 Modal Pemilik sebagai akun penyeimbang — harta dikurangi
--    utang MEMANG definisi modal, jadi tidak perlu akun penampung tersendiri.
--    (Lihat lib/saldo-awal.ts.)

-- 4. Baris pengaturan kunci periode WAJIB ada.
--    Ditemukan saat audit: tabelnya kosong di database, sehingga `update ... where id`
--    dari layar Tutup Buku mengenai 0 baris — layarnya bilang "periode dikunci" padahal
--    tidak ada yang terkunci, dan trigger pengamannya membaca null (= selalu terbuka).
insert into accounting_locks (id) values (true) on conflict (id) do nothing;
