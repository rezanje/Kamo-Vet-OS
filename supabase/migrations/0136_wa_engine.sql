-- PRD §8: WA Engine dengan 7 trigger retensi, riwayat kirim, dan anti dobel.

create table if not exists wa_engine_settings (
  id boolean primary key default true check (id),
  is_enabled boolean not null default false,
  post_grooming_enabled boolean not null default true,
  post_treatment_enabled boolean not null default true,
  vaccination_due_enabled boolean not null default true,
  vaccination_overdue_enabled boolean not null default true,
  lapsed_enabled boolean not null default true,
  owner_birthday_enabled boolean not null default true,
  pet_birthday_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into wa_engine_settings (id) values (true) on conflict (id) do nothing;

create table if not exists whatsapp_message_log (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  pet_id uuid references pets(id) on delete set null,
  branch_id uuid references branches(id) on delete set null,
  trigger_key varchar(32) not null check (trigger_key in (
    'post_grooming', 'post_treatment', 'vaccination_due', 'vaccination_overdue',
    'lapsed', 'owner_birthday', 'pet_birthday', 'receipt'
  )),
  idempotency_key varchar(180) not null unique,
  phone varchar(30) not null,
  message text not null,
  status varchar(16) not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  provider_message_id varchar(120),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_message_log_status_idx on whatsapp_message_log(status, created_at);
create index if not exists whatsapp_message_log_customer_idx on whatsapp_message_log(customer_id, created_at desc);

alter table wa_engine_settings enable row level security;
alter table whatsapp_message_log enable row level security;

drop policy if exists wa_settings_read on wa_engine_settings;
drop policy if exists wa_settings_write on wa_engine_settings;
create policy wa_settings_read on wa_engine_settings for select to authenticated using (true);
create policy wa_settings_write on wa_engine_settings for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER', 'ADMIN')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER', 'ADMIN')));

drop policy if exists wa_log_read on whatsapp_message_log;
create policy wa_log_read on whatsapp_message_log for select to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role in ('OWNER', 'ADMIN')));
create policy wa_log_write on whatsapp_message_log for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role in ('OWNER', 'ADMIN')))
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('OWNER', 'ADMIN')));
