-- Obat khusus rawat inap (permintaan drh. Ilham, 24 Agustus).
--
-- "Beberapa obat ada protokolnya, misalnya hanya 3 hari. Agar tetap sesuai
-- protokol, tambah kolom obat khusus — jadi kelihatan sudah pakai obat berapa kali
-- dan berapa hari. Siapa pun yang inject bisa ada track record, dan dokter PJ bisa
-- kontrol jarak jauh."
--
-- Dua tabel, bukan satu: protokolnya ditulis sekali (obat apa, berapa kali sehari,
-- berapa hari), lalu tiap pemberian dicatat sendiri. Tanpa pemisahan itu, "sudah
-- diberikan berapa kali" cuma bisa ditebak dari catatan bebas.

create table if not exists inpatient_medications (
  id uuid primary key default gen_random_uuid(),
  inpatient_record_id uuid not null references inpatient_records(id) on delete cascade,
  item_id uuid references items(id) on delete set null,   -- kosong = obat luar master
  nama_obat varchar(120) not null,
  dosis varchar(60),                                      -- mis. "1 ml IV"
  frekuensi_per_hari int not null default 1 check (frekuensi_per_hari between 1 and 12),
  durasi_hari int not null default 1 check (durasi_hari between 1 and 60),
  mulai_tanggal date not null default current_date,
  rute varchar(20),                                       -- IV / IM / SC / oral / topikal
  catatan text,
  dihentikan_at timestamptz,                              -- protokol distop lebih awal
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inpatient_medications_record_idx on inpatient_medications(inpatient_record_id);

-- Satu baris = satu kali obat benar-benar diberikan. Append-only seperti laporan
-- harian: yang salah dicatat dibatalkan dengan penanda, bukan dihapus.
create table if not exists inpatient_med_doses (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references inpatient_medications(id) on delete cascade,
  diberikan_at timestamptz not null default now(),
  diberikan_oleh uuid references profiles(id) on delete set null,
  nama_pemberi varchar(100),                              -- jejak nama walau akunnya dihapus
  catatan text,
  dibatalkan_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists inpatient_med_doses_med_idx on inpatient_med_doses(medication_id);

alter table inpatient_medications enable row level security;
alter table inpatient_med_doses enable row level security;

create policy inpatient_medications_all on inpatient_medications for all to authenticated
  using (true) with check (true);
create policy inpatient_med_doses_sel on inpatient_med_doses for select to authenticated using (true);
create policy inpatient_med_doses_ins on inpatient_med_doses for insert to authenticated with check (true);
create policy inpatient_med_doses_upd on inpatient_med_doses for update to authenticated using (true) with check (true);
