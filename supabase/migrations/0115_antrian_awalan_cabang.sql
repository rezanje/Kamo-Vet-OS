-- Nomor antrian pakai awalan kode cabang (permintaan Pak Andri, meeting 14 Agustus).
-- "A001" tidak bisa dibedakan antar cabang begitu dibacakan di grup lintas cabang;
-- sekarang formatnya CMGG-A001. Kolomnya cuma muat 8 huruf, jadi dilebarkan.
alter table visits alter column queue_number type varchar(16);

comment on column visits.queue_number is
  'Nomor antrian harian: <KODE CABANG>-<HURUF POLI><3 digit>, mis. CMGG-A001.';
