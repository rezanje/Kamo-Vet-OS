-- Pemantauan harian rawat inap (permintaan tim klinik 2026-08-06).
--
-- Sebelumnya kondisi pasien ditulis bebas dalam satu paragraf. Isinya lengkap,
-- tapi tidak bisa dihitung: "sudah berapa hari tidak BAB" atau "beratnya naik
-- atau turun" harus dibaca manual satu per satu — persis yang bikin repot saat
-- pergantian shift.
--
-- Kolom baru ini TIDAK menggantikan catatan bebas; keduanya jalan bersama.
-- Yang terstruktur untuk dihitung & digrafikkan, yang bebas untuk cerita
-- klinis yang tidak muat di kolom.

alter table inpatient_daily_logs add column if not exists makan text;
alter table inpatient_daily_logs add column if not exists minum text;
alter table inpatient_daily_logs add column if not exists bab text;
alter table inpatient_daily_logs add column if not exists pipis text;
alter table inpatient_daily_logs add column if not exists berat numeric(6,2);
alter table inpatient_daily_logs add column if not exists suhu numeric(4,1);
alter table inpatient_daily_logs add column if not exists foto_url text;

-- Nilai dipagari di database supaya angka & hitungan tren tidak pernah dihitung
-- dari ejaan yang berbeda-beda ("tidak ada" vs "gaada" vs "-").
do $$ begin
  alter table inpatient_daily_logs add constraint idl_makan_chk
    check (makan is null or makan in ('habis', 'sebagian', 'tidak mau'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table inpatient_daily_logs add constraint idl_minum_chk
    check (minum is null or minum in ('normal', 'sedikit', 'tidak mau'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table inpatient_daily_logs add constraint idl_bab_chk
    check (bab is null or bab in ('normal', 'cair', 'keras', 'berdarah', 'tidak ada'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table inpatient_daily_logs add constraint idl_pipis_chk
    check (pipis is null or pipis in ('normal', 'sedikit', 'berdarah', 'tidak ada'));
exception when duplicate_object then null; end $$;

-- Batas wajar, bukan batas medis: menahan salah ketik (berat 750 kg, suhu 395).
do $$ begin
  alter table inpatient_daily_logs add constraint idl_berat_chk
    check (berat is null or (berat > 0 and berat <= 200));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table inpatient_daily_logs add constraint idl_suhu_chk
    check (suhu is null or (suhu >= 25 and suhu <= 45));
exception when duplicate_object then null; end $$;

-- Papan pemantauan selalu membaca log satu pasien urut tanggal.
create index if not exists idx_idl_record_tanggal
  on inpatient_daily_logs (inpatient_record_id, log_date);

-- Komunikasi ke pemilik (permintaan tim klinik): siapa pun yang membuka laporan
-- harus bisa tahu owner sudah dikabari apa saja pada hari itu — tanpa bertanya
-- ke shift sebelumnya. Ditaruh di log harian, bukan di data pasien, karena isinya
-- berubah tiap visit.
alter table inpatient_daily_logs add column if not exists komunikasi_owner text;
alter table inpatient_daily_logs add column if not exists komunikasi_via text;

do $$ begin
  alter table inpatient_daily_logs add constraint idl_komunikasi_via_chk
    check (komunikasi_via is null or komunikasi_via in ('WhatsApp', 'Telepon', 'Bertemu langsung'));
exception when duplicate_object then null; end $$;
