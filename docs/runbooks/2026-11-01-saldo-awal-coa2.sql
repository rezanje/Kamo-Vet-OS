-- Saldo awal dari berkas COA_2.xlsx (Reza, 1 Nov 2026) lewat fungsi resmi
-- create_opening_balance_atomic — BUKAN menulis jurnal manual. Satu transaksi.
--
-- Fungsi resmi ini: hanya OWNER/ADMIN/FINANCE dengan akses semua cabang; hanya akun rincian
-- aktif ASET/LIABILITAS/EKUITAS; menolak bila jurnal 'saldo-awal' sudah pernah ada; menolak
-- akun rekening yang sudah punya saldo pembuka; menolak periode yang sudah ditutup; selisih
-- debit-kredit otomatis ke Modal Pemilik (410001) — aturan bawaan sistem, bukan dibuat di sini.
--
-- 29 akun bersaldo (Debit 802,042,075 / Kredit 112,321,228); selisih 689,720,847 masuk Modal Pemilik (Kredit).
--   110001  D          527,246  Kas Blu BCA
--   110002  D        2,080,130  Kas Kecil Gudang (Bu Fitri)
--   110004  D        2,437,500  Kas Toko BTKM
--   110005  D        2,340,000  Kas Toko CIAWI
--   110006  D        2,076,000  Kas Toko CMS
--   110007  D        3,391,500  Kas Toko CMGG
--   110008  D        1,495,000  Kas Toko MUAR
--   110009  D          878,000  Kas Toko TKI
--   110010  D        3,960,000  Kas Toko GRND
--   110011  D        1,686,001  Kas Toko SRKN
--   110012  D        1,612,100  Kas Toko PDRY
--   110013  D          310,500  Kas Toko Vet CMS
--   110014  D        1,889,500  Kas Toko Vet CMGG
--   110015  D        2,003,000  Kas Toko Vet CIAW
--   110016  D          175,830  Kas Toko Vet PDRY
--   110018  D          510,000  Kas Toko Vet GRDA
--   110020  D          840,000  Kas Toko Vet SRKN
--   120001  D        1,064,355  Bank BCA Toko (1740260461)
--   120002  D      132,135,191  Bank BCA Transaksi (4270086743)
--   120003  D          372,267  Bank BCA Gudang (4270242486)
--   120005  D       85,928,385  Bank BCA Margin (427085759)
--   120006  D          842,536  Bank BCA Tabungan (4270378361)
--   181002  D      472,858,281  Sewa Gedung Dibayar dimuka
--   181004  D       42,725,778  Barang Expired Dibayar Dumika
--   181005  D        7,699,975  Gajihub Dibayar Dimuka
--   181007  D       11,200,000  ERP Dibayar Dimuka
--   182001  D        7,230,000  Cashbon Karyawan
--   182003  D       11,773,000  Pinjaman Karyawan
--   312003  K      112,321,228  Utang THR
--
-- Isi dua nilai sebelum menjalankan:
--   :owner_id  = id profil OWNER aktif yang mencatat (mis. akun Reza)
--   :tanggal   = tanggal saldo awal (usulan: 2026-10-31, hari tutup buku Accurate)
-- Contoh psql: psql ... -v owner_id="'<uuid>'" -v tanggal="'2026-10-31'" -f berkas_ini.sql

\set ON_ERROR_STOP on
begin;

-- 1. Pemeriksaan awal (berhenti bila tidak sesuai).
do $$ declare bad text; begin
 if exists(select 1 from public.journal_entries where source='saldo-awal') then
  raise exception 'STOP: jurnal saldo awal sudah ada — fungsi resmi hanya bisa sekali. Jangan lanjut; laporkan.';end if;
 select string_agg(c,', ') into bad from unnest(array['110001','110002','110004','110005','110006','110007','110008','110009','110010','110011','110012','110013','110014','110015','110016','110018','110020','120001','120002','120003','120005','120006','181002','181004','181005','181007','182001','182003','312003']) c
  where not exists(select 1 from public.coa_accounts a where a.code=c and a.is_active and not a.is_header and a.type in('ASET','LIABILITAS','EKUITAS'));
 if bad is not null then raise exception 'STOP: akun tidak tersedia/bukan akun rincian aktif: %',bad;end if;
 if not exists(select 1 from public.coa_accounts where code='410001' and is_active and not is_header and type='EKUITAS') then
  raise exception 'STOP: Modal Pemilik 410001 tidak tersedia';end if;
end $$;

-- 2. Jalankan fungsi resmi sebagai OWNER (identitas sesi hanya untuk transaksi ini).
select set_config('request.jwt.claims',json_build_object('sub',:owner_id,'role','authenticated')::text,true);
select set_config('request.jwt.claim.sub',:owner_id,true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select public.create_opening_balance_atomic('saldo-awal-coa2-1nov2026',:tanggal::date,'[{"code": "110001", "nilai": 527246, "sisi": "D"}, {"code": "110002", "nilai": 2080130, "sisi": "D"}, {"code": "110004", "nilai": 2437500, "sisi": "D"}, {"code": "110005", "nilai": 2340000, "sisi": "D"}, {"code": "110006", "nilai": 2076000, "sisi": "D"}, {"code": "110007", "nilai": 3391500, "sisi": "D"}, {"code": "110008", "nilai": 1495000, "sisi": "D"}, {"code": "110009", "nilai": 878000, "sisi": "D"}, {"code": "110010", "nilai": 3960000, "sisi": "D"}, {"code": "110011", "nilai": 1686001, "sisi": "D"}, {"code": "110012", "nilai": 1612100, "sisi": "D"}, {"code": "110013", "nilai": 310500, "sisi": "D"}, {"code": "110014", "nilai": 1889500, "sisi": "D"}, {"code": "110015", "nilai": 2003000, "sisi": "D"}, {"code": "110016", "nilai": 175830, "sisi": "D"}, {"code": "110018", "nilai": 510000, "sisi": "D"}, {"code": "110020", "nilai": 840000, "sisi": "D"}, {"code": "120001", "nilai": 1064355, "sisi": "D"}, {"code": "120002", "nilai": 132135191, "sisi": "D"}, {"code": "120003", "nilai": 372267, "sisi": "D"}, {"code": "120005", "nilai": 85928385, "sisi": "D"}, {"code": "120006", "nilai": 842536, "sisi": "D"}, {"code": "181002", "nilai": 472858281, "sisi": "D"}, {"code": "181004", "nilai": 42725778, "sisi": "D"}, {"code": "181005", "nilai": 7699975, "sisi": "D"}, {"code": "181007", "nilai": 11200000, "sisi": "D"}, {"code": "182001", "nilai": 7230000, "sisi": "D"}, {"code": "182003", "nilai": 11773000, "sisi": "D"}, {"code": "312003", "nilai": 112321228, "sisi": "K"}]'::jsonb) as hasil;
reset role;

-- 3. Baca ulang: satu jurnal seimbang, 30 baris, Modal Kredit 689,720,847.
select e.no_jurnal,e.tanggal,count(*) baris,sum(l.debit) debit,sum(l.credit) kredit,
 sum(l.credit) filter(where a.code='410001') modal_kredit
from public.journal_entries e join public.journal_lines l on l.entry_id=e.id join public.coa_accounts a on a.id=l.account_id
where e.source='saldo-awal' group by e.no_jurnal,e.tanggal;

commit;
