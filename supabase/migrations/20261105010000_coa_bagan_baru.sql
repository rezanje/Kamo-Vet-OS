-- Bagan akun (COA) baru KAMO — kode 6 digit dari berkas COA Reza 31 Okt 2026.
--
-- Pola kelompok baru: 1 kas/bank & aset lancar, 2 aset tetap, 3 liabilitas, 4 ekuitas,
-- 5 pendapatan (52xxxx = retur/diskon, pengurang pendapatan), 6 HPP, 7 beban,
-- 81 pendapatan di luar operasional, 82 beban di luar operasional.
--
-- Cara kerja (satu transaksi, aman diulang):
--  1. Akun lama yang dipakai sistem DIGANTI KODENYA di tempat (bukan dibuat ulang), jadi
--     seluruh riwayat jurnal ikut pindah — jurnal menempel ke akun lewat id, bukan kode.
--  2. Kolom yang menyimpan kode akun (rekening kas/bank, transaksi kas, anggaran, kebijakan
--     demo klinik, alokasi pembayaran POS) ikut berganti lewat ON UPDATE CASCADE; kolom teks
--     & jejak JSON (kas pelunasan, rekonsiliasi bank, kategori aset, snapshot rekening)
--     diperbarui eksplisit. Trigger pengguna di tabel-tabel itu dimatikan HANYA selama
--     penggantian lalu dinyalakan lagi (penjaga imutabilitas tidak boleh menolak cascade).
--  3. Akun dari berkas yang belum ada ditambahkan; induk & penanda akun induk diatur.
--  4. Semua fungsi database yang menyebut kode lama secara tertulis ditulis ulang ke kode baru.
--  5. Aturan kode akun baru di impor COA mengikuti pola 6 digit.
-- Tidak ada jurnal, saldo, atau stok yang dibuat/diubah nilainya. Akun buatan pengguna yang
-- tidak ada di pemetaan dibiarkan apa adanya.
--
-- Pilihan SEMENTARA (tandai untuk dicek finance): 1101→110003 Kas Kecil (kas bawaan),
-- 1102→120002 BCA Transaksi (bank bawaan), 1501→200008, 1509→200015, 5601→750004,
-- 5301→720002, 5304→740007, 4301→810001, 4303→810004; akun baru 130009 Piutang
-- Marketplace, 311003 Utang Barang Belum Difakturkan, 740020 Beban Komisi Marketplace.
-- Kode dobel di berkas dinomori urut: kas 110001–110022, bank 120001–120006.
-- Saldo normal dibetulkan: 200011 D, 530000–530002 K, 430000–430002 D.

do $$ begin
 if to_regclass('public.coa_accounts') is null
  or to_regprocedure('public.import_coa_accounts(jsonb,text)') is null
  or to_regprocedure('public.coa_import_system_codes()') is null
 then raise exception 'COA_BARU_SOURCE_CHANGED: tinjau ulang kontrak bagan akun';end if;
end $$;

create temp table coa_recode(old_code text primary key, new_code text unique not null) on commit drop;
insert into coa_recode values
 ('1101','110003'),
 ('1102','120002'),
 ('1105','182004'),
 ('1201','150001'),
 ('1202','130009'),
 ('1203','182001'),
 ('1301','170001'),
 ('1302','170003'),
 ('1303','160001'),
 ('1401','181001'),
 ('1501','200008'),
 ('1509','200015'),
 ('2101','311001'),
 ('2102','311003'),
 ('2103','314001'),
 ('2201','312005'),
 ('2301','312001'),
 ('3101','410001'),
 ('3201','420001'),
 ('4101','510001'),
 ('4102','520002'),
 ('4201','510002'),
 ('4301','810001'),
 ('4302','810003'),
 ('4303','810004'),
 ('5101','600001'),
 ('5201','710001'),
 ('5301','720002'),
 ('5302','740001'),
 ('5303','740003'),
 ('5304','740007'),
 ('5305','740020'),
 ('5401','760003'),
 ('5501','740010'),
 ('5601','750004'),
 ('5602','820004'),
 ('5901','760002'),
 ('5902','720010');

create temp table coa_target(code text primary key, name text not null, type text not null, normal text not null, parent text, header boolean not null) on commit drop;
insert into coa_target values
 ('100000','Kas & Bank','ASET','D',null,true),
 ('110000','Kas','ASET','D','100000',true),
 ('110001','Kas Blu BCA','ASET','D','110000',false),
 ('110002','Kas Kecil Gudang (Bu Fitri)','ASET','D','110000',false),
 ('110003','Kas Kecil','ASET','D','110000',false),
 ('110004','Kas Toko BTKM','ASET','D','110000',false),
 ('110005','Kas Toko CIAWI','ASET','D','110000',false),
 ('110006','Kas Toko CMS','ASET','D','110000',false),
 ('110007','Kas Toko CMGG','ASET','D','110000',false),
 ('110008','Kas Toko MUAR','ASET','D','110000',false),
 ('110009','Kas Toko TKI','ASET','D','110000',false),
 ('110010','Kas Toko GRND','ASET','D','110000',false),
 ('110011','Kas Toko SRKN','ASET','D','110000',false),
 ('110012','Kas Toko PDRY','ASET','D','110000',false),
 ('110013','Kas Toko Vet CMS','ASET','D','110000',false),
 ('110014','Kas Toko Vet CMGG','ASET','D','110000',false),
 ('110015','Kas Toko Vet CIAW','ASET','D','110000',false),
 ('110016','Kas Toko Vet PDRY','ASET','D','110000',false),
 ('110017','Kas Toko Vet TKI','ASET','D','110000',false),
 ('110018','Kas Toko Vet GRDA','ASET','D','110000',false),
 ('110019','Kas Toko Vet GRLG','ASET','D','110000',false),
 ('110020','Kas Toko Vet SRKN','ASET','D','110000',false),
 ('110021','Kas Toko Vet GRND','ASET','D','110000',false),
 ('120000','Bank','ASET','D','100000',true),
 ('120001','Bank BCA Toko (1740260461)','ASET','D','120000',false),
 ('120002','Bank BCA Transaksi (4270086743)','ASET','D','120000',false),
 ('120003','Bank BCA Gudang (4270242486)','ASET','D','120000',false),
 ('120004','Bank BCA Kas General (4270367998)','ASET','D','120000',false),
 ('120005','Bank BCA Margin (427085759)','ASET','D','120000',false),
 ('120006','Bank BCA Tabungan (4270378361)','ASET','D','120000',false),
 ('130000','Ecommers','ASET','D','100000',true),
 ('130001','Tiktok B2C','ASET','D','130000',false),
 ('130002','Lazada B2C','ASET','D','130000',false),
 ('130003','Shopee B2C','ASET','D','130000',false),
 ('130004','Shopee Bogor','ASET','D','130000',false),
 ('130005','Shopee Bandung','ASET','D','130000',false),
 ('130006','Tokopedia Bogor','ASET','D','130000',false),
 ('130007','Lazada Bogor','ASET','D','130000',false),
 ('130008','Tokopedia Bandung','ASET','D','130000',false),
 ('130009','Piutang Marketplace','ASET','D','130000',false),
 ('140000','Setara Kas','ASET','D','100000',true),
 ('140001','Deposito Bank','ASET','D','140000',false),
 ('150000','Piutang Usaha','ASET','D','100000',true),
 ('150001','Piutang Usaha','ASET','D','150000',false),
 ('160000','Uang Muka Pembelian','ASET','D','100000',true),
 ('160001','Deposit Supplier','ASET','D','160000',false),
 ('170000','Persediaan','ASET','D','100000',true),
 ('170001','Persediaan','ASET','D','170000',false),
 ('170002','Persediaan Terkirim','ASET','D','170000',false),
 ('170003','Persediaan Dalam Proses','ASET','D','170000',false),
 ('180000','Aset Lancar Lain','ASET','D','100000',true),
 ('181000','Biaya Dibayar Dimuka','ASET','D','180000',true),
 ('181001','Perlengkapan Kantor','ASET','D','181000',false),
 ('181002','Sewa Gedung Dibayar dimuka','ASET','D','181000',false),
 ('181003','Asuransi Dibayar Dimuka','ASET','D','181000',false),
 ('181004','Barang Expired Dibayar Dumika','ASET','D','181000',false),
 ('181005','Gajihub Dibayar Dimuka','ASET','D','181000',false),
 ('181006','THR Dibayar Dimuka','ASET','D','181000',false),
 ('181007','ERP Dibayar Dimuka','ASET','D','181000',false),
 ('182000','Piutang Diluar Usaha','ASET','D','180000',true),
 ('182001','Cashbon Karyawan','ASET','D','182000',false),
 ('182002','Piutang Seragam','ASET','D','182000',false),
 ('182003','Pinjaman Karyawan','ASET','D','182000',false),
 ('182004','PPN Masukan','ASET','D','182000',false),
 ('182005','PPh 22 Dibayar Dimuka','ASET','D','182000',false),
 ('182006','PPh 23 Dibayar Dimuka','ASET','D','182000',false),
 ('182007','PPh 25 Dibayar Dimuka','ASET','D','182000',false),
 ('182008','Aset Lancar Lainnya','ASET','D','182000',false),
 ('200000','Aset Tetap','ASET','D',null,true),
 ('200001','Tanah','ASET','D','200000',false),
 ('200002','Bangunan','ASET','D','200000',false),
 ('200003','Renovasi Bangunan','ASET','D','200000',false),
 ('200004','Kendaraan','ASET','D','200000',false),
 ('200005','Mesin dan Peralatan Gudang','ASET','D','200000',false),
 ('200006','Peralatan Toko','ASET','D','200000',false),
 ('200007','Peralatan Veterinary','ASET','D','200000',false),
 ('200008','Peralatan Kantor','ASET','D','200000',false),
 ('200009','Peralatan Produksi','ASET','D','200000',false),
 ('200010','Inventaris Kantor','ASET','D','200000',false),
 ('200011','Aset Tetap Dalam Pembangunan','ASET','D','200000',false),
 ('200012','Akumulasi Penyusutan Bangunan','ASET','K','200000',false),
 ('200013','Akumulasi Penyusutan Kendaraan','ASET','K','200000',false),
 ('200014','Akumulasi Penyusutan Mesin','ASET','K','200000',false),
 ('200015','Akumulasi Penyusutan Peralatan','ASET','K','200000',false),
 ('200016','Akumulasi Penyusutan Inventaris','ASET','K','200000',false),
 ('300000','Liabilitas','LIABILITAS','K',null,true),
 ('310000','Liabilitas Jangka Pendek','LIABILITAS','K','300000',true),
 ('311000','Utang Usaha','LIABILITAS','K','310000',true),
 ('311001','Utang Supplier','LIABILITAS','K','311000',false),
 ('311002','Utang Usaha Lainnya','LIABILITAS','K','311000',false),
 ('311003','Utang Barang Belum Difakturkan','LIABILITAS','K','311000',false),
 ('312000','Utang Operasional','LIABILITAS','K','310000',true),
 ('312001','Utang Gaji','LIABILITAS','K','312000',false),
 ('312002','Utang Bonus dan Insentif','LIABILITAS','K','312000',false),
 ('312003','Utang THR','LIABILITAS','K','312000',false),
 ('312004','Utang Sewa','LIABILITAS','K','312000',false),
 ('312005','Utang PPN','LIABILITAS','K','312000',false),
 ('312006','Utang PPh 21','LIABILITAS','K','312000',false),
 ('312007','Utang PPh 23','LIABILITAS','K','312000',false),
 ('312008','Utang PPh 25','LIABILITAS','K','312000',false),
 ('312009','Utang PPh 4 ayat 2','LIABILITAS','K','312000',false),
 ('312010','Utang Pajak Lainnya','LIABILITAS','K','312000',false),
 ('313000','Utang Bank Jangka Pendek','LIABILITAS','K','310000',true),
 ('313001','Pinjaman Bank Jangka Pendek','LIABILITAS','K','313000',false),
 ('313002','Utang Kartu Kredit Perusahaan','LIABILITAS','K','313000',false),
 ('314000','Uang Muka Pelanggan','LIABILITAS','K','310000',true),
 ('314001','Uang Muka Penjualan','LIABILITAS','K','314000',false),
 ('314002','Deposit Pelanggan','LIABILITAS','K','314000',false),
 ('315000','Liabilitas Lancar Lainnya','LIABILITAS','K','310000',true),
 ('315001','Pendapatan Diterima Dimuka','LIABILITAS','K','315000',false),
 ('315002','Ulang Lain-lain','LIABILITAS','K','315000',false),
 ('320000','Liabilitas Jangka Panjang','LIABILITAS','K','300000',true),
 ('320001','Pinjaman Bank Jangka Panjang','LIABILITAS','K','320000',false),
 ('400000','Ekuitas','EKUITAS','K',null,true),
 ('410000','Modal Disetor','EKUITAS','K','400000',true),
 ('410001','Modal Pemilik','EKUITAS','K','410000',false),
 ('410002','Modal Disetor Tambahan','EKUITAS','K','410000',false),
 ('420000','Saldo Laba','EKUITAS','K','400000',true),
 ('420001','Saldo Laba Ditahan','EKUITAS','K','420000',false),
 ('420002','Laba Tahun Berjalan','EKUITAS','K','420000',false),
 ('430000','Prive dan Distribusi kepada pemilik','EKUITAS','D','400000',true),
 ('430001','Prive','EKUITAS','D','430000',false),
 ('430002','Dividen','EKUITAS','D','430000',false),
 ('500000','Pendapatan','PENDAPATAN','K',null,true),
 ('510000','Pendapatan','PENDAPATAN','K','500000',true),
 ('510001','Pendapatan Penjualan','PENDAPATAN','K','510000',false),
 ('510002','Pendapatan Jasa','PENDAPATAN','K','510000',false),
 ('510003','Pendapatan Usaha Lainnya','PENDAPATAN','K','510000',false),
 ('510004','Pendapatan Komisi','PENDAPATAN','K','510000',false),
 ('520000','Retur dan Potongan','PENDAPATAN','D','500000',true),
 ('520001','Retur Penjualan','PENDAPATAN','D','520000',false),
 ('520002','Diskon Penjualan','PENDAPATAN','D','520000',false),
 ('520003','Voucher dan Promo Penjualan','PENDAPATAN','D','520000',false),
 ('520004','Potongan Penjualan Lain','PENDAPATAN','D','520000',false),
 ('530000','Pendapatan Lainnya','PENDAPATAN','K','500000',true),
 ('530001','Pendapatan Bunga Bank','PENDAPATAN','K','530000',false),
 ('530002','Pendapatan Bunga Deposito','PENDAPATAN','K','530000',false),
 ('600000','Harga Pokok Penjualan','BEBAN','D',null,true),
 ('600001','HPP Penjualan Barang','BEBAN','D','600000',false),
 ('600002','Biaya Angkut Pembelian','BEBAN','D','600000',false),
 ('700000','Beban','BEBAN','D',null,true),
 ('710000','Beban Gaji dan Karyawan','BEBAN','D','700000',true),
 ('710001','Beban Gaji dan Tunjangan','BEBAN','D','710000',false),
 ('710002','Beban THR','BEBAN','D','710000',false),
 ('710003','Beban Bonus dan Insentif','BEBAN','D','710000',false),
 ('710004','Beban BPJS Kesehatan','BEBAN','D','710000',false),
 ('710005','Beban BPJS Ketenagakerjaan','BEBAN','D','710000',false),
 ('710006','Beban Rekrutmen dan Pelatihan','BEBAN','D','710000',false),
 ('710007','Beban Seragam Karyawan','BEBAN','D','710000',false),
 ('710008','Beban Tenaga Kerja Harian','BEBAN','D','710000',false),
 ('720000','Beban Sewa dan Fasilitas','BEBAN','D','700000',true),
 ('720001','Beban Sewa Gedung','BEBAN','D','720000',false),
 ('720002','Beban Listrik','BEBAN','D','720000',false),
 ('720003','Beban Air','BEBAN','D','720000',false),
 ('720004','Beban Internet dan Telpon','BEBAN','D','720000',false),
 ('720005','Beban Kebersihan','BEBAN','D','720000',false),
 ('720006','Beban Keamanan','BEBAN','D','720000',false),
 ('720007','Beban Pemeliharaan Gedung','BEBAN','D','720000',false),
 ('720008','Beban Perbaikan dan Renovasi','BEBAN','D','720000',false),
 ('720009','Beban Pengelolaan Lingkungan / IPL','BEBAN','D','720000',false),
 ('720010','Beban Selisih Stok','BEBAN','D','720000',false),
 ('730000','Beban Marketing','BEBAN','D','700000',true),
 ('730001','Beban Iklan dan Promosi','BEBAN','D','730000',false),
 ('730002','Beban Marketing Kit','BEBAN','D','730000',false),
 ('740000','Beban Operasional','BEBAN','D','700000',true),
 ('740001','Beban Perlengkapan Toko','BEBAN','D','740000',false),
 ('740002','Beban ATK','BEBAN','D','740000',false),
 ('740003','Beban Transport','BEBAN','D','740000',false),
 ('740004','Beban perjalanan Dinas','BEBAN','D','740000',false),
 ('740005','Beban Bensin, Parkir dan Tol','BEBAN','D','740000',false),
 ('740006','Beban Pemeliharaan Kendaraan','BEBAN','D','740000',false),
 ('740007','Beban Perbaikan Peralatan','BEBAN','D','740000',false),
 ('740008','Beban Langganan Sofrware dan ERP','BEBAN','D','740000',false),
 ('740009','Beban Langganan Gajihub','BEBAN','D','740000',false),
 ('740010','Beban Admin Bank','BEBAN','D','740000',false),
 ('740011','Beban Asuransi','BEBAN','D','740000',false),
 ('740012','Beban Ekspedisi','BEBAN','D','740000',false),
 ('740013','Beban Kebutuhan Grooming','BEBAN','D','740000',false),
 ('740014','Beban Print dan Fotocopy','BEBAN','D','740000',false),
 ('740015','Beban Invesment','BEBAN','D','740000',false),
 ('740016','Beban Kebutuhan RT','BEBAN','D','740000',false),
 ('740017','Beban Tips / Ongkir','BEBAN','D','740000',false),
 ('740018','Beban Admin EDC','BEBAN','D','740000',false),
 ('740019','Beban Sewa Kendaraan','BEBAN','D','740000',false),
 ('740020','Beban Komisi Marketplace','BEBAN','D','740000',false),
 ('750000','Beban Penyusutan','BEBAN','D','700000',true),
 ('750001','Beban Penyusutan Bangungan','BEBAN','D','750000',false),
 ('750002','Beban Penyusutan Renovasi Bangunan','BEBAN','D','750000',false),
 ('750003','Beban Penyusutan Kendaraan','BEBAN','D','750000',false),
 ('750004','Beban Penyusutan Mesin dan Peralatan','BEBAN','D','750000',false),
 ('760000','Beban Operasional Lain','BEBAN','D','700000',true),
 ('760001','Beban Kerugian Piutang','BEBAN','D','760000',false),
 ('760002','Beban Selisih Kas','BEBAN','D','760000',false),
 ('760003','Beban Operasional Lain','BEBAN','D','760000',false),
 ('800000','Pendapatan dan Beban Diluar Operasional','PENDAPATAN','K',null,true),
 ('810000','Pendapatan Diluar Operasional','PENDAPATAN','K','800000',true),
 ('810001','Pendapatan Bunga Bank','PENDAPATAN','K','810000',false),
 ('810002','Pendapatan Bunga Deposito','PENDAPATAN','K','810000',false),
 ('810003','Keuntungan penjualan Aset Tetap','PENDAPATAN','K','810000',false),
 ('810004','Pendapatan Diluar Operasional Lain','PENDAPATAN','K','810000',false),
 ('820000','Beban diluar Operasional','BEBAN','D',null,true),
 ('820001','Beban diluar Operasional','BEBAN','D','820000',false),
 ('820002','Beban Bunga Pinjaman','BEBAN','D','820000',false),
 ('820003','Beban Admin Pinjaman','BEBAN','D','820000',false),
 ('820004','Kerugian Penjualan Aset Tetap','BEBAN','D','820000',false),
 ('820005','Beban Denda diluar Operasional','BEBAN','D','820000',false),
 ('820006','Beban diluar Operasional Lainnya','BEBAN','D','820000',false);

-- 0. Konflik: kode lama DAN kode barunya sama-sama ada sebagai dua akun berbeda.
do $$ declare bad text; begin
 select string_agg(m.old_code||'→'||m.new_code,', ') into bad from coa_recode m
  where exists(select 1 from public.coa_accounts where code=m.old_code) and exists(select 1 from public.coa_accounts where code=m.new_code);
 if bad is not null then raise exception 'COA_BARU_CONFLICT: kode lama dan baru sama-sama ada: %',bad;end if;
 -- Kelompok/saldo normal akun yang sudah ada tidak diubah (mengubahnya membalik riwayat).
 select string_agg(a.code||' ('||a.type||'/'||a.normal_balance||' vs '||t.type||'/'||t.normal||')',', ') into bad
  from public.coa_accounts a left join coa_recode m on m.old_code=a.code join coa_target t on t.code=coalesce(m.new_code,a.code)
  where a.type<>t.type or a.normal_balance<>t.normal;
 if bad is not null then raise exception 'COA_BARU_TYPE: kelompok/saldo normal akun lama berbeda dari bagan baru: %',bad;end if;
end $$;

-- 0b. Cadangan bagan akun sebelum perubahan (sekali saja) — dipakai naskah rollback untuk
--     mengembalikan kode, nama, induk dan penanda induk persis seperti semula.
create table if not exists public.coa_bagan_baru_backup(
 id uuid primary key, code text not null, name text not null, parent_id uuid, is_header boolean, is_active boolean,
 captured_at timestamptz not null default now());
alter table public.coa_bagan_baru_backup enable row level security;
revoke all on public.coa_bagan_baru_backup from public,anon,authenticated,service_role;
insert into public.coa_bagan_baru_backup(id,code,name,parent_id,is_header,is_active)
 select id,code,name,parent_id,is_header,is_active from public.coa_accounts
 where not exists(select 1 from public.coa_bagan_baru_backup)
   and exists(select 1 from public.coa_accounts a join coa_recode m on m.old_code=a.code);

-- 1. Kelompok dari kode: pola 6 digit baru; kode 4–5 digit lama tetap memakai pola lama.
create or replace function public.coa_type_for_code(p_code text) returns text
language sql immutable set search_path='' as $$
 select case
  when p_code ~ '^[0-9]{6}$' then case
    when p_code ~ '^[12]' then 'ASET' when p_code ~ '^3' then 'LIABILITAS' when p_code ~ '^4' then 'EKUITAS'
    when p_code ~ '^5' then 'PENDAPATAN' when p_code ~ '^[67]' then 'BEBAN'
    when p_code ~ '^8[01]' then 'PENDAPATAN' when p_code ~ '^82' then 'BEBAN' end
  when p_code ~ '^[1-5][0-9]{3,4}$' then case left(p_code,1)
    when '1' then 'ASET' when '2' then 'LIABILITAS' when '3' then 'EKUITAS' when '4' then 'PENDAPATAN' else 'BEBAN' end
 end
$$;
revoke all on function public.coa_type_for_code(text) from public,anon;
grant execute on function public.coa_type_for_code(text) to authenticated,service_role;

-- 2. Pendapatan bersaldo Debit hanya untuk kelompok retur/diskon 52xxxx (dulu hanya 4102).
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.coa_accounts'::regclass and contype='c'
   and pg_get_constraintdef(oid) like '%PENDAPATAN%' and pg_get_constraintdef(oid) like '%normal_balance%' loop
  execute format('alter table public.coa_accounts drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.coa_accounts add constraint coa_accounts_normal_balance_wajar check (
 (type='PENDAPATAN' and (normal_balance='K' or code ~ '^52[0-9]{4}$' or code='4102'))
 or (type='BEBAN' and normal_balance='D')
 or type not in('PENDAPATAN','BEBAN'));

-- 3. Semua FK ke coa_accounts(code) ikut berganti bila kode akun berganti.
do $$ declare c record; def text; begin
 for c in select conname,conrelid::regclass tbl,pg_get_constraintdef(oid) d from pg_constraint
   where confrelid='public.coa_accounts'::regclass and contype='f'
    and confkey=array[(select attnum from pg_attribute where attrelid='public.coa_accounts'::regclass and attname='code')]::smallint[] loop
  def:=regexp_replace(c.d,' ON UPDATE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)','')||' ON UPDATE CASCADE';
  execute format('alter table %s drop constraint %I, add constraint %I %s',c.tbl,c.conname,c.conname,def);
 end loop;
end $$;

-- 4. Ganti kode di tempat + kolom teks/JSON yang menyimpan kode.
do $$ declare t text; touched text[]:=array['cash_accounts','cash_entries','budgets','budget_transfers','clinic_demo_policies',
 'sale_payments','asset_categories','bank_reconciliations','clinic_payment_receipt_parts','invoice_payments','clinic_refunds','sales_refund_payouts'];
begin
 foreach t in array touched loop
  if to_regclass('public.'||t) is not null then execute format('alter table public.%I disable trigger user',t);end if;
 end loop;
 update public.coa_accounts a set code=m.new_code from coa_recode m where a.code=m.old_code;
 update public.asset_categories set akun_beban=m.new_code from coa_recode m where akun_beban=m.old_code;
 update public.asset_categories set akun_akumulasi=m.new_code from coa_recode m where akun_akumulasi=m.old_code;
 update public.bank_reconciliations set bank_coa_code=m.new_code from coa_recode m where bank_coa_code=m.old_code;
 update public.clinic_payment_receipt_parts set kas_code=m.new_code from coa_recode m where kas_code=m.old_code;
 update public.invoice_payments set kas_code=m.new_code from coa_recode m where kas_code=m.old_code;
 foreach t in array array['sale_payments','clinic_refunds','sales_refund_payouts'] loop
  execute format($f$update public.%I x set account_snapshot=jsonb_set(account_snapshot,'{code}',to_jsonb(m.new_code)) from pg_temp.coa_recode m where x.account_snapshot->>'code'=m.old_code$f$,t);
  execute format($f$update public.%I x set account_snapshot=jsonb_set(account_snapshot,'{coa_code}',to_jsonb(m.new_code)) from pg_temp.coa_recode m where x.account_snapshot->>'coa_code'=m.old_code$f$,t);
 end loop;
 foreach t in array touched loop
  if to_regclass('public.'||t) is not null then execute format('alter table public.%I enable trigger user',t);end if;
 end loop;
end $$;
alter table public.asset_categories alter column akun_beban set default '750004', alter column akun_akumulasi set default '200015';

-- 5. Akun baru dari berkas, lalu nama, induk, dan penanda akun induk.
insert into public.coa_accounts(code,name,type,normal_balance,is_active,is_header)
 select t.code,t.name,t.type,t.normal,true,t.header from coa_target t
 where not exists(select 1 from public.coa_accounts a where a.code=t.code);
update public.coa_accounts a set name=t.name,is_active=true from coa_target t where a.code=t.code and (a.name<>t.name or not a.is_active);
do $$ declare bad text; begin
 select string_agg(t.code,', ') into bad from coa_target t join public.coa_accounts a on a.code=t.code
  where t.header and exists(select 1 from public.journal_lines l where l.account_id=a.id);
 if bad is not null then raise exception 'COA_BARU_PARENT: akun berjurnal tidak bisa menjadi akun induk: %',bad;end if;
end $$;
update public.coa_accounts a set is_header=t.header,parent_id=p.id
 from coa_target t left join public.coa_accounts p on p.code=t.parent
 where a.code=t.code and (a.is_header is distinct from t.header or a.parent_id is distinct from p.id);

-- 6. Fungsi database: kode lama yang tertulis langsung (literal, pesan, komentar) diganti ke kode baru.
do $$ declare f record; def text; m record; begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname not in('pg_catalog','information_schema') and n.nspname not like 'pg_%' and p.prokind in('f','p')
    and p.prosrc ~ '(?<![0-9.])(1101|1102|1105|1201|1202|1203|1301|1302|1303|1401|1501|1509|2101|2102|2103|2201|2301|3101|3201|4101|4102|4201|4301|4302|4303|5101|5201|5301|5302|5303|5304|5305|5401|5501|5601|5602|5901|5902)(?![0-9])'
    and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') loop
  def:=pg_get_functiondef(f.oid);
  -- Literal kode ('1301') maupun sebutan di pesan/komentar ("Akun 1301 …") ikut diganti;
  -- angka lain yang kebetulan bersambung dengan digit/titik tidak disentuh.
  for m in select * from pg_temp.coa_recode loop
   def:=regexp_replace(def,'(?<![0-9.])'||m.old_code||'(?![0-9])',m.new_code,'g');
  end loop;
  execute def;
 end loop;
end $$;

-- 7. Impor COA: akun baru wajib pola 6 digit; jatah kode rekening otomatis pindah ke
--    110023–119999 (kas) dan 120007–129999 (bank); retur/diskon 52xxxx boleh bersaldo Debit.
do $$ declare def text;
 a1 text:=$a$case when code ~ '^[1-5][0-9]{3,5}$' then
      type <> (case left(code, 1) when '1' then 'ASET' when '2' then 'LIABILITAS' when '3' then 'EKUITAS'
                                  when '4' then 'PENDAPATAN' else 'BEBAN' end)
      or code::integer between 1103 and 1199$a$;
 b1 text:=$b$case when code ~ '^[1-8][0-9]{5}$' then
      type is distinct from public.coa_type_for_code(code)
      or code::integer between 110023 and 119999 or code::integer between 120007 and 129999$b$;
 a2 text:=$a$(type = 'PENDAPATAN' and normal_balance <> 'K')$a$;
 b2 text:=$b$(type = 'PENDAPATAN' and normal_balance <> 'K' and code !~ '^52[0-9]{4}$')$b$;
 a3 text:=$a$type <> (case left(code, 1) when '1' then 'ASET' when '2' then 'LIABILITAS' when '3' then 'EKUITAS'
                                    when '4' then 'PENDAPATAN' when '5' then 'BEBAN' else '' end)$a$;
 b3 text:=$b$type is distinct from public.coa_type_for_code(code)$b$;
begin
 def:=pg_get_functiondef('public.import_coa_accounts(jsonb,text)'::regprocedure);
 if strpos(def,b3)>0 and strpos(def,a3)=0 then return;end if; -- sudah diterapkan
 if (length(def)-length(replace(def,a1,'')))/length(a1)<>1 or (length(def)-length(replace(def,a3,'')))/length(a3)<>1
  or strpos(def,a2)=0 then raise exception 'COA_BARU_IMPORT_ANCHOR: jangkar aturan impor COA tidak dikenali';end if;
 execute replace(replace(replace(def,a1,b1),a2,b2),a3,b3);
end $$;

-- 8. Pemeriksaan akhir.
do $$ declare bad text; begin
 select string_agg(m.new_code,', ') into bad from coa_recode m
  where not exists(select 1 from public.coa_accounts a where a.code=m.new_code and a.is_active and not a.is_header);
 if bad is not null then raise exception 'COA_BARU_CHECK: akun sistem baru tidak aktif/rincian: %',bad;end if;
 if (select count(*) from public.coa_accounts a join coa_target t using(code))<>207 then raise exception 'COA_BARU_CHECK: jumlah akun bagan baru tidak lengkap';end if;
 select string_agg(n.nspname||'.'||p.proname,', ') into bad from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname not in('pg_catalog','information_schema') and p.prosrc ~ '(?<![0-9.])(1101|1102|1105|1201|1202|1203|1301|1302|1303|1401|1501|1509|2101|2102|2103|2201|2301|3101|3201|4101|4102|4201|4301|4302|4303|5101|5201|5301|5302|5303|5304|5305|5401|5501|5601|5602|5901|5902)(?![0-9])'
   and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e');
 if bad is not null then raise exception 'COA_BARU_CHECK: fungsi masih memakai kode lama: %',bad;end if;
 if exists(select 1 from public.coa_accounts c join public.coa_accounts p on p.id=c.parent_id where p.type<>c.type or not p.is_header) then
  raise exception 'COA_BARU_CHECK: induk akun tidak konsisten';end if;
end $$;
