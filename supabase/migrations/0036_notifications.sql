-- Notifikasi pusat (promo/target/system) ke frontliner kasir. branch_ids null/empty = semua cabang.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  type text not null default 'promo' check (type in ('promo', 'target', 'system')),
  branch_ids uuid[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

alter table notifications enable row level security;
create policy notifications_all on notifications for all to authenticated using (true) with check (true);

-- Demo: satu pengumuman promo (semua cabang) + satu target (semua cabang).
insert into notifications (title, message, type) values
  ('Promo Baru dari Pusat', 'Promo bundling grooming + vitamin berlaku mulai hari ini di semua cabang. Tawarkan ke pelanggan!', 'promo'),
  ('Target Bulanan Juli', 'Target omset cabang bulan ini naik 10% dari bulan lalu. Semangat kejar target harian ya!', 'target');
