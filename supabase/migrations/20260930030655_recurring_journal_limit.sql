alter table public.recurring_journals
  add column max_occurrences integer
  check (max_occurrences > 0);

comment on column public.recurring_journals.max_occurrences is
  'NULL = berjalan tanpa batas; angka positif = berhenti setelah sejumlah jurnal berhasil diposting.';
