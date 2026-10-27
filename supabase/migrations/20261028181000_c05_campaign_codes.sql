-- C05: kode promo/kampanye (supersedes drafts #225, #228, #236).
--
-- Business rules (docs/reports/2026-10-28-keputusan-default.md, C05):
--   * a campaign code is bound to exactly one existing voucher OR promo;
--   * optional usage cap per code (NULL = unlimited);
--   * only active OWNER/ADMIN create or change codes.
--
-- One code field at checkout: the cashier types the campaign code where a voucher code goes.
-- Voucher-bound: the bound voucher's own rules and formula apply unchanged.
-- Promo-bound: that promo is applied to this transaction (also when it is not "potong otomatis").
-- Usage = non-void POS receipts + non-void clinic invoices that carry the code. The cap is
-- enforced by a trigger that locks the code row before counting, so concurrent checkouts are
-- serialized and can never exceed it. A void frees the use; a clinic reissue keeps the
-- original use (it is never counted twice).

create table if not exists public.campaign_codes (
  id uuid primary key default gen_random_uuid(),
  code varchar(24) not null unique
    constraint campaign_codes_code_format check (code ~ '^[A-Z0-9_-]{3,24}$'),
  voucher_id uuid references public.vouchers(id) on delete cascade,
  promo_id uuid references public.promos(id) on delete cascade,
  max_uses integer constraint campaign_codes_max_uses_positive check (max_uses is null or max_uses > 0),
  is_active boolean not null default true,
  note text constraint campaign_codes_note_length check (note is null or length(note) <= 200),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_codes_one_target check ((voucher_id is null) <> (promo_id is null))
);
comment on table public.campaign_codes is
  'C05 campaign code: alias for one existing voucher or promo, optional usage cap. Usage is counted from sales/invoices.campaign_code.';

alter table public.campaign_codes enable row level security;
revoke all on public.campaign_codes from public, anon;
grant select, insert, update, delete on public.campaign_codes to authenticated;
-- Cashiers must resolve codes at checkout, like vouchers (readable by every signed-in user).
drop policy if exists campaign_codes_read on public.campaign_codes;
create policy campaign_codes_read on public.campaign_codes for select to authenticated using (true);
drop policy if exists campaign_codes_manager_insert on public.campaign_codes;
create policy campaign_codes_manager_insert on public.campaign_codes for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid())
    and p.is_active and p.role in ('OWNER','ADMIN')));
drop policy if exists campaign_codes_manager_update on public.campaign_codes;
create policy campaign_codes_manager_update on public.campaign_codes for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid())
    and p.is_active and p.role in ('OWNER','ADMIN')))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid())
    and p.is_active and p.role in ('OWNER','ADMIN')));
drop policy if exists campaign_codes_manager_delete on public.campaign_codes;
create policy campaign_codes_manager_delete on public.campaign_codes for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid())
    and p.is_active and p.role in ('OWNER','ADMIN')));

-- A campaign code must never also be a voucher code (either direction, any write path).
create or replace function public.guard_campaign_code_collision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('vetos:c05-code:' || upper(new.code), 0));
  if tg_table_name = 'campaign_codes' then
    if exists (select 1 from public.vouchers v where upper(v.code) = upper(new.code)) then
      raise exception 'KODE_KAMPANYE: Kode % sudah dipakai sebagai kode voucher', new.code using errcode = '23505';
    end if;
  elsif exists (select 1 from public.campaign_codes c where c.code = upper(new.code)) then
    raise exception 'KODE_KAMPANYE: Kode % sudah dipakai sebagai kode kampanye', new.code using errcode = '23505';
  end if;
  return new;
end $$;
revoke all on function public.guard_campaign_code_collision() from public, anon, authenticated, service_role;
drop trigger if exists c05_campaign_code_collision on public.campaign_codes;
create trigger c05_campaign_code_collision before insert or update of code on public.campaign_codes
  for each row execute function public.guard_campaign_code_collision();
drop trigger if exists c05_voucher_code_collision on public.vouchers;
create trigger c05_voucher_code_collision before insert or update of code on public.vouchers
  for each row execute function public.guard_campaign_code_collision();

-- Snapshot of the typed campaign code on each document; voucher_code stays the real voucher.
alter table public.sales add column if not exists campaign_code varchar(24);
alter table public.invoices add column if not exists campaign_code varchar(24);
create index if not exists sales_campaign_code_idx on public.sales (campaign_code) where campaign_code is not null;
create index if not exists invoices_campaign_code_idx on public.invoices (campaign_code) where campaign_code is not null;

create or replace function public.guard_campaign_code_use() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k public.campaign_codes%rowtype; v_voucher text; v_used bigint; src_id uuid; src_code text; src_voucher text;
begin
  if tg_op = 'UPDATE' then
    if new.campaign_code is distinct from old.campaign_code then
      raise exception 'KODE_KAMPANYE: Kode kampanye pada dokumen tidak boleh diubah' using errcode = '23514';
    end if;
    if new.campaign_code is not null and new.voucher_code is distinct from old.voucher_code then
      raise exception 'KODE_KAMPANYE: Voucher dari kode kampanye tidak boleh diubah' using errcode = '23514';
    end if;
    return new;
  end if;

  -- Clinic void+reissue: the new invoice inherits the original code and its single use.
  if tg_table_name = 'invoices' then
    src_id := (to_jsonb(new) ->> 'reissued_from')::uuid;   -- sales rows have no such column
  end if;
  if src_id is not null then
    select i.campaign_code, i.voucher_code into src_code, src_voucher
      from public.invoices i where i.id = src_id;
    if new.campaign_code is null then new.campaign_code := src_code; end if;
    if new.campaign_code is distinct from src_code then
      raise exception 'KODE_KAMPANYE: Penerbitan ulang tidak boleh mengganti kode kampanye' using errcode = '23514';
    end if;
    if src_code is not null and new.voucher_code is distinct from src_voucher then
      raise exception 'KODE_KAMPANYE: Voucher dari kode kampanye tidak boleh diubah' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.campaign_code is null then return new; end if;

  -- Row lock serializes every checkout of this code until its transaction ends.
  select * into k from public.campaign_codes c where c.code = new.campaign_code for update;
  if not found then
    raise exception 'KODE_KAMPANYE: Kode % tidak ditemukan', new.campaign_code using errcode = 'P0001';
  end if;
  if not k.is_active then
    raise exception 'KODE_KAMPANYE: Kode % sedang dinonaktifkan', k.code using errcode = 'P0001';
  end if;
  if k.voucher_id is not null then
    select v.code into v_voucher from public.vouchers v where v.id = k.voucher_id;
    if new.voucher_code is distinct from v_voucher then
      raise exception 'KODE_KAMPANYE: Kode % harus memakai voucher %', k.code, v_voucher using errcode = '23514';
    end if;
  elsif new.voucher_code is not null then
    raise exception 'KODE_KAMPANYE: Kode promo % tidak bisa digabung dengan voucher', k.code using errcode = '23514';
  end if;
  if k.max_uses is not null then
    select (select count(*) from public.sales s where s.campaign_code = k.code and s.voided_at is null)
         + (select count(*) from public.invoices i where i.campaign_code = k.code and i.voided_at is null)
      into v_used;
    if v_used >= k.max_uses then
      raise exception 'KODE_KAMPANYE: Kode % sudah mencapai batas pemakaian (% kali)', k.code, k.max_uses
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_campaign_code_use() from public, anon, authenticated, service_role;
drop trigger if exists c05_sale_campaign_code on public.sales;
create trigger c05_sale_campaign_code before insert or update of campaign_code, voucher_code on public.sales
  for each row execute function public.guard_campaign_code_use();
drop trigger if exists c05_invoice_campaign_code on public.invoices;
create trigger c05_invoice_campaign_code before insert or update of campaign_code, voucher_code on public.invoices
  for each row execute function public.guard_campaign_code_use();

-- Usage per code for the manager screen (counts only; documents stay under their own RLS).
create or replace function public.campaign_code_usage()
returns table(code text, used bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles p where p.id = (select auth.uid())
                 and p.is_active and p.role in ('OWNER','ADMIN')) then
    raise exception 'Akses ditolak' using errcode = '42501';
  end if;
  return query
    select c.code::text,
      (select count(*) from public.sales s where s.campaign_code = c.code and s.voided_at is null)
      + (select count(*) from public.invoices i where i.campaign_code = c.code and i.voided_at is null)
    from public.campaign_codes c order by c.code;
end $$;
revoke all on function public.campaign_code_usage() from public, anon, service_role;
grant execute on function public.campaign_code_usage() to authenticated;

-- Clinic posting stores the code inside its own atomic invoice insert (single, counted anchor;
-- split and DEMO posting call this core with the same p_invoice JSON).
do $patch$
declare
  signature regprocedure := 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure;
  definition text := pg_get_functiondef(signature);
  cols_old text := 'paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id, service_pricing_version';
  vals_old text := E'v_shift.id, v_voucher, v_salesperson_id, nullif(p_invoice->>''service_pricing_version'','''')::smallint';
begin
  if position('campaign_code' in definition) > 0 then
    return;                                        -- already applied (idempotent re-run)
  end if;
  if (length(definition) - length(replace(definition, cols_old, ''))) / length(cols_old) <> 1
     or (length(definition) - length(replace(definition, vals_old, ''))) / length(vals_old) <> 1 then
    raise exception 'C05_CLINIC_POST_DRIFT: clinic_post_invoice changed; review before release';
  end if;
  definition := replace(definition, cols_old, cols_old || ', campaign_code');
  definition := replace(definition, vals_old, vals_old || E', nullif(p_invoice->>''campaign_code'','''')');
  execute definition;
end
$patch$;
