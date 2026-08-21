-- Aturan formulir persetujuan bisa diatur dari layar (permintaan Aldi, 19 Agustus:
-- "kalau tindakan dan formulir apa bisa ada menu settingnya").
--
-- Sampai sekarang daftar tindakan yang wajib berformulir dikunci di kode
-- (lib/tindakan.ts → WAJIB_CONSENT). Klinik tidak bisa menambah atau melonggarkan
-- tanpa lewat developer, padahal isi dan cakupannya urusan mereka.

create table if not exists consent_rules (
  kategori varchar(30) primary key,
  wajib boolean not null default false,
  -- Formulir bawaan untuk kategori ini; kosong = dokter memilih sendiri.
  template_id uuid references consent_templates(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table consent_rules enable row level security;
-- Baca terbuka: layar rekam medis & pembayaran perlu tahu tindakan mana yang wajib.
create policy consent_rules_read on consent_rules for select to authenticated using (true);
-- Tulis hanya OWNER/ADMIN — ini aturan yang menahan pembayaran, bukan preferensi tampilan.
create policy consent_rules_write on consent_rules for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER', 'ADMIN')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER', 'ADMIN')));

-- Isi awal = persis aturan yang berlaku hari ini, supaya perilakunya tidak berubah
-- diam-diam saat fitur ini menyala.
insert into consent_rules (kategori, wajib) values
  ('Konsultasi', false),
  ('Vaksinasi',  true),
  ('Operasi',    true),
  ('Grooming',   false),
  ('Rawat Inap', true),
  ('Lab',        true)
on conflict (kategori) do nothing;
