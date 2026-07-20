-- Follow up terjadwal per rekam medis + worklist reminder pelanggan.
-- Sebelumnya cuma medical_records.follow_up (teks bebas, gak bisa diingatkan).
-- Kolom lama sengaja dibiarkan: dokumen rekam medis yg sudah dicetak tetap konsisten.

create table follow_ups (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references visits(id) on delete set null,
  medical_record_id uuid references medical_records(id) on delete cascade,
  pet_id uuid not null references pets(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  branch_id uuid references branches(id) on delete set null,
  jenis text not null default 'Kontrol'
    check (jenis in ('Kontrol', 'Vaksin', 'Grooming', 'Obat habis', 'Lainnya')),
  tanggal date not null,                     -- kapan pelanggan harus diingatkan
  catatan text,
  status text not null default 'Menunggu'
    check (status in ('Menunggu', 'Terkirim', 'Selesai', 'Batal')),
  reminded_at timestamptz,                   -- diisi saat staff klik kirim WhatsApp
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Worklist utamanya "yang jatuh tempo & belum ditindak", jadi index ke situ.
create index on follow_ups(tanggal, status);
create index on follow_ups(pet_id);
create index on follow_ups(medical_record_id);

alter table follow_ups enable row level security;
create policy fu_all on follow_ups for all to authenticated using (true) with check (true);
