-- Bagan akun bertingkat (header–detail) — permintaan Aldi 2026-08-13.
--
-- Sekarang bagan akun datar: 40 akun berjajar tanpa induk, jadi laporan tidak bisa
-- menampilkan "Beban Operasional" sebagai satu angka yang bisa dibuka rinciannya.
-- Akuntan terbiasa dengan struktur induk–rincian seperti di Accurate.
--
-- Aturannya cuma dua, dan keduanya ditegakkan di aplikasi + di sini:
--   1. Jurnal HANYA boleh menempel di akun detail. Akun induk itu penjumlahan;
--      kalau ikut diposting, saldonya dihitung dua kali di laporan.
--   2. Induk harus sekelompok dengan anaknya (aset di bawah aset), supaya
--      subtotalnya tidak mencampur dua kelompok yang berbeda arah saldonya.
alter table coa_accounts
  add column if not exists parent_id uuid references coa_accounts(id) on delete restrict,
  add column if not exists is_header boolean not null default false;

create index if not exists coa_accounts_parent_idx on coa_accounts(parent_id);

comment on column coa_accounts.parent_id is
  'Akun induk (header). Null = akun tingkat atas.';
comment on column coa_accounts.is_header is
  'true = akun penjumlahan; tidak boleh dipakai memposting jurnal.';

-- Pengaman terakhir: walau semua jalur uang lewat postJournal, satu skrip manual
-- yang salah cukup untuk merusak laporan selamanya. Ditolak di database.
create or replace function tolak_jurnal_ke_akun_header() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from coa_accounts a where a.id = new.account_id and a.is_header) then
    raise exception 'Akun induk tidak boleh dipakai memposting jurnal — pilih akun rinciannya.';
  end if;
  return new;
end;
$$;

drop trigger if exists journal_lines_tolak_header on journal_lines;
create trigger journal_lines_tolak_header
  before insert or update on journal_lines
  for each row execute function tolak_jurnal_ke_akun_header();
