-- HRIS fase 4: slip gaji otomatis. Rincian disimpan supaya slip bisa dicetak ulang
-- kapan saja tanpa menghitung ulang — absensi, aturan gaji, dan komponen bisa berubah
-- setelah gaji disahkan, dan slip lama harus tetap menunjukkan angka aslinya.

alter table payrolls
  add column hari_kerja int not null default 0,
  add column hari_hadir int not null default 0,
  add column hari_bolos int not null default 0,
  add column menit_telat int not null default 0,
  add column jam_lembur numeric(6,2) not null default 0,
  add column upah_lembur numeric(15,2) not null default 0,
  add column potongan_telat numeric(15,2) not null default 0,
  add column potongan_bolos numeric(15,2) not null default 0,
  add column cicilan_kasbon numeric(15,2) not null default 0,
  add column reimburse numeric(15,2) not null default 0,
  -- Koreksi manual pemilik. Positif = menambah, negatif = mengurangi.
  add column penyesuaian numeric(15,2) not null default 0,
  add column catatan text,
  add column status varchar(10) not null default 'draft' check (status in ('draft', 'final')),
  add column disahkan_at timestamptz,
  add column disahkan_by uuid references profiles(id) on delete set null;

-- Satu baris gaji per karyawan per periode. Tanpa ini, "Hitung" dua kali bisa
-- menggandakan slip dan jurnalnya.
create unique index payrolls_periode_employee on payrolls(periode, employee_id);

comment on column payrolls.penyesuaian is
  'Koreksi manual sebelum disahkan; hasil hitungan otomatis tidak ditimpa supaya jejaknya tetap terbaca.';
