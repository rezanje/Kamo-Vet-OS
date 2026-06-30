-- CRM: field tambahan customer & anabul (PRD Addendum §1.1, §1.2)

alter table customers
  add column pekerjaan   varchar(80),
  add column sumber_info varchar(60),               -- acquisition channel (§1.1)
  add column catatan     text,
  add column keanggotaan varchar(12) not null default 'Non Member';  -- Member / Non Member

alter table pets
  add column golongan_darah varchar(8),
  add column microchip      varchar(40),
  add column sterilisasi    varchar(8),             -- Utuh / Steril
  add column alergi         text,
  add column kondisi_khusus text,
  add column warna          varchar(60),
  add column status         varchar(12) not null default 'Aktif';  -- Aktif / Tidak Aktif / RIP

-- ponytail: weight stays a single column for now. §1.2 wants a time-series
-- (pet_weights table logged per visit) — add when the rekam-medis flow records weight per kunjungan.
