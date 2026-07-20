-- Master SKU: jasa tidak boleh lagi diketik bebas di rekam medis (spec 2026-07-20).
-- Kategori tindakan pindah ke item supaya aturan consent (§6.3) tidak bisa diakali
-- staff dgn memilih kategori ringan untuk tindakan berisiko.
alter table items add column tindakan_kategori text
  check (tindakan_kategori in ('Konsultasi', 'Vaksinasi', 'Operasi', 'Grooming', 'Rawat Inap', 'Lab'));

comment on column items.tindakan_kategori is
  'Hanya untuk item kategori Jasa. Menentukan wajib/tidaknya form persetujuan.';

-- Halaman master SKU perlu membuat item baru; sebelumnya hanya update yg diizinkan.
create policy items_insert on items for insert to authenticated with check (true);
