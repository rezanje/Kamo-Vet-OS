-- Addendum §4: antrian real-time — nomor antrian + waktu panggil + broadcast realtime.
alter table visits
  add column queue_number varchar(8),
  add column called_at timestamptz;
-- dashboard antrian update live tanpa polling (Supabase Realtime, channel per branch).
alter publication supabase_realtime add table visits;
