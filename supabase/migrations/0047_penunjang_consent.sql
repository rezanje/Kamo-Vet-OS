-- Foto hasil pemeriksaan penunjang + form persetujuan (consent) digital.

-- 1) Foto penunjang: array kolom, bukan tabel. Foto di-upload saat form masih diisi,
-- sementara baris medical_records baru ada saat submit — pola sama dgn pets.photo_url.
alter table medical_records add column penunjang_urls text[];

-- 2) Template consent — teks dgn placeholder, diedit admin di /klinik/persetujuan.
create table consent_templates (
  id uuid primary key default gen_random_uuid(),
  nama varchar(120) not null,
  isi text not null,                       -- placeholder: {nama_pemilik}, {nama_hewan}, dst
  branch_id uuid references branches(id) on delete cascade,  -- null = semua cabang
  is_active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on consent_templates(branch_id);

-- 3) Form persetujuan per kunjungan.
create table consents (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits(id) on delete cascade,
  template_id uuid references consent_templates(id) on delete set null,
  tindakan varchar(200) not null,
  -- Salinan isi saat form dibuat. WAJIB: kalau template diedit belakangan, dokumen yg
  -- sudah ditandatangani harus tetap menunjukkan apa yg benar-benar disetujui.
  isi_snapshot text not null,
  signer_name varchar(120),
  signature_data text,                     -- data URL PNG dari canvas (bukan di storage)
  signed_at timestamptz,
  status text not null default 'belum_ttd' check (status in ('belum_ttd', 'sudah_ttd')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on consents(visit_id);

alter table consent_templates enable row level security;
alter table consents enable row level security;

create policy ct_all on consent_templates for all to authenticated using (true) with check (true);
create policy cs_all on consents for all to authenticated using (true) with check (true);

-- 4) Bucket privat utk foto medis. pet-photos sengaja dibiarkan publik (bukan data medis).
insert into storage.buckets (id, name, public) values ('medical-docs', 'medical-docs', false)
on conflict (id) do nothing;

create policy medical_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'medical-docs');
create policy medical_docs_write on storage.objects for insert to authenticated
  with check (bucket_id = 'medical-docs');
create policy medical_docs_update on storage.objects for update to authenticated
  using (bucket_id = 'medical-docs');
create policy medical_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'medical-docs');
