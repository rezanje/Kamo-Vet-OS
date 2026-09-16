-- P1: bounded daily/monthly recurring journals with atomic, idempotent history.

alter table public.recurring_journals
  add column if not exists frequency varchar(10) not null default 'monthly'
    check (frequency in ('daily', 'monthly')),
  add column if not exists start_date date,
  add column if not exists repeat_count integer,
  add column if not exists run_count integer not null default 0,
  add column if not exists status varchar(10) not null default 'active'
    check (status in ('active', 'completed', 'inactive'));

update public.recurring_journals
set start_date = coalesce(start_date, created_at::date),
    repeat_count = coalesce(repeat_count, 120),
    status = case when is_active then 'active' else 'inactive' end
where start_date is null or repeat_count is null;
alter table public.recurring_journals alter column start_date set not null;
alter table public.recurring_journals alter column repeat_count set not null;
alter table public.recurring_journals add constraint recurring_repeat_count_positive check (repeat_count > 0);

create table if not exists public.recurring_journal_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.recurring_journals(id) on delete cascade,
  run_date date not null,
  occurrence_no integer not null,
  journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (schedule_id, run_date),
  unique (schedule_id, occurrence_no)
);
alter table public.recurring_journal_runs enable row level security;
create policy recurring_runs_all on public.recurring_journal_runs for all to authenticated using (true) with check (true);

create or replace function public.run_recurring_occurrence(p_schedule_id uuid, p_run_date date)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_schedule public.recurring_journals%rowtype;
  v_entry_id uuid;
  v_line jsonb;
  v_account_id uuid;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_occurrence integer;
begin
  select * into v_schedule from public.recurring_journals where id = p_schedule_id for update;
  if not found then raise exception 'Jadwal tidak ditemukan'; end if;
  select journal_entry_id into v_entry_id from public.recurring_journal_runs
  where schedule_id = p_schedule_id and run_date = p_run_date;
  if v_entry_id is not null then return v_entry_id; end if;
  if v_schedule.status <> 'active' then raise exception 'Jadwal tidak aktif'; end if;
  if v_schedule.run_count >= v_schedule.repeat_count then
    update public.recurring_journals set status = 'completed', is_active = false where id = p_schedule_id;
    raise exception 'Jumlah pengulangan sudah terpenuhi';
  end if;
  v_occurrence := v_schedule.run_count + 1;
  v_entry_id := gen_random_uuid();
  insert into public.journal_entries (id, no_jurnal, tanggal, deskripsi, source, source_ref, branch_id)
  values (
    v_entry_id, 'JRN-' || to_char(p_run_date, 'YYYYMM') || '-' || upper(substr(replace(v_entry_id::text, '-', ''), 1, 8)),
    p_run_date, v_schedule.nama || ' (transaksi berulang ' || v_occurrence || '/' || v_schedule.repeat_count || ')',
    'recurring', substr(v_schedule.id::text, 1, 8) || '-' || to_char(p_run_date, 'YYYY-MM-DD'), v_schedule.branch_id
  );
  for v_line in select * from jsonb_array_elements(v_schedule.lines) loop
    v_debit := coalesce((v_line->>'debit')::numeric, 0);
    v_credit := coalesce((v_line->>'credit')::numeric, 0);
    select id into v_account_id from public.coa_accounts where code = v_line->>'code' and is_header is not true;
    if v_account_id is null then raise exception 'Akun jurnal berulang tidak valid'; end if;
    if v_debit > 0 or v_credit > 0 then
      insert into public.journal_lines (entry_id, account_id, debit, credit) values (v_entry_id, v_account_id, v_debit, v_credit);
      v_total_debit := v_total_debit + v_debit;
      v_total_credit := v_total_credit + v_credit;
    end if;
  end loop;
  if v_total_debit <= 0 or round(v_total_debit, 2) <> round(v_total_credit, 2) then raise exception 'Jurnal berulang tidak seimbang'; end if;
  insert into public.recurring_journal_runs (schedule_id, run_date, occurrence_no, journal_entry_id)
  values (p_schedule_id, p_run_date, v_occurrence, v_entry_id);
  update public.recurring_journals
  set run_count = v_occurrence,
      last_posted = to_char(p_run_date, 'YYYY-MM'),
      status = case when v_occurrence >= repeat_count then 'completed' else 'active' end,
      is_active = v_occurrence < repeat_count
  where id = p_schedule_id;
  return v_entry_id;
end;
$$;

revoke all on function public.run_recurring_occurrence(uuid, date) from public;
grant execute on function public.run_recurring_occurrence(uuid, date) to authenticated;
