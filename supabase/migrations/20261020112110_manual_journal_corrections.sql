-- Manual journal corrections preserve the original posted ledger entry.
alter table public.journal_entries
  add column if not exists revision integer not null default 0,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists void_reason text;

create or replace function public.guard_journal_correction_metadata() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if current_user in ('authenticated','anon') and (tg_op='INSERT' and (coalesce(new.revision,0)<>0 or new.voided_at is not null or new.voided_by is not null or new.void_reason is not null) or tg_op='UPDATE' and (new.revision is distinct from old.revision or new.voided_at is distinct from old.voided_at or new.voided_by is distinct from old.voided_by or new.void_reason is distinct from old.void_reason)) then
    raise exception 'Metadata koreksi jurnal hanya boleh diubah melalui jalur koreksi resmi' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists journal_correction_metadata_guard on public.journal_entries;
create trigger journal_correction_metadata_guard before insert or update on public.journal_entries for each row execute function public.guard_journal_correction_metadata();

create table public.journal_revisions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.journal_entries(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete set null,
  action text not null check (action in ('edit','void')),
  reason text not null,
  before_value jsonb not null,
  after_value jsonb not null,
  reversal_journal_id uuid not null references public.journal_entries(id) on delete restrict,
  replacement_journal_id uuid references public.journal_entries(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index journal_revisions_entry_idx on public.journal_revisions(entry_id, created_at);
alter table public.journal_revisions enable row level security;
revoke all on public.journal_revisions from public, anon, authenticated, service_role;
grant select on public.journal_revisions to authenticated;
create policy journal_revisions_read on public.journal_revisions for select to authenticated
  using (branch_id is null or public.user_can_access_branch(branch_id));

create table public.journal_revision_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_key text not null,
  entry_id uuid not null references public.journal_entries(id) on delete restrict,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_key)
);
alter table public.journal_revision_requests enable row level security;
revoke all on public.journal_revision_requests from public, anon, authenticated, service_role;

create or replace function public.revise_manual_journal(
  p_request_key text,
  p_entry_id uuid,
  p_expected_revision integer,
  p_action text,
  p_header jsonb,
  p_lines jsonb,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_prior public.journal_revision_requests%rowtype;
  v_audit uuid := gen_random_uuid();
  v_reversal uuid := gen_random_uuid();
  v_replacement uuid;
  v_payload jsonb;
  v_result jsonb;
  v_date date;
  v_description text;
  v_closed date;
  v_total_debit numeric;
  v_total_credit numeric;
  v_count integer;
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Hanya Super Admin yang bisa mengoreksi jurnal' using errcode='42501'; end if;
  if nullif(btrim(coalesce(p_request_key,'')),'') is null or length(p_request_key)>120 or p_entry_id is null
     or p_expected_revision is null or p_expected_revision < 0
     or p_action is null or p_action not in ('edit','void')
     or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then
    raise exception 'Identitas, tindakan, atau alasan koreksi tidak valid';
  end if;
  v_payload:=jsonb_build_object('entry_id',p_entry_id,'revision',p_expected_revision,
    'action',p_action,'header',coalesce(p_header,'{}'::jsonb),'lines',coalesce(p_lines,'[]'::jsonb),
    'reason',btrim(p_reason));
  perform pg_advisory_xact_lock(hashtextextended('vetos:manual-journal:'||auth.uid()::text||':'||p_request_key,0));
  select * into v_entry from public.journal_entries where id=p_entry_id for update;
  if not found then raise exception 'Jurnal tidak ditemukan'; end if;
  if v_entry.branch_id is not null and not public.user_can_access_branch(v_entry.branch_id) then
    raise exception 'Cabang jurnal tidak dapat diakses' using errcode='42501';
  end if;
  select * into v_profile from public.profiles where id=auth.uid() for update;
  if not found or not v_profile.is_active or v_profile.role<>'OWNER' then raise exception 'Hanya Super Admin yang bisa mengoreksi jurnal' using errcode='42501'; end if;
  select * into v_prior from public.journal_revision_requests
    where actor_id=auth.uid() and request_key=p_request_key;
  if found then
    if v_prior.payload<>v_payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda'; end if;
    return v_prior.result;
  end if;

  if v_entry.source not in ('manual','manual-correction') then raise exception 'Jurnal otomatis harus dikoreksi dari transaksi sumbernya'; end if;
  if v_entry.branch_id is not null and not public.user_can_access_branch(v_entry.branch_id) then
    raise exception 'Cabang jurnal tidak dapat diakses' using errcode='42501';
  end if;
  if v_entry.revision<>p_expected_revision then raise exception 'Jurnal sudah berubah. Muat ulang sebelum mengoreksi'; end if;
  if v_entry.voided_at is not null then raise exception 'Jurnal sudah dibatalkan'; end if;
  select closed_until into v_closed from public.accounting_locks where id for update;
  if v_closed is not null and v_entry.tanggal<=v_closed then raise exception 'Periode akuntansi sudah ditutup'; end if;
  v_date:=coalesce(nullif(p_header->>'tanggal','')::date,v_entry.tanggal);
  v_description:=coalesce(nullif(btrim(p_header->>'deskripsi'),''),v_entry.deskripsi);
  if v_date> (now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal jurnal belum boleh di masa depan'; end if;
  if v_closed is not null and v_date<=v_closed then raise exception 'Periode akuntansi sudah ditutup'; end if;

  perform 1 from public.journal_lines where entry_id=v_entry.id for update;
  select coalesce(sum(debit),0),coalesce(sum(credit),0),count(*)
    into v_total_debit,v_total_credit,v_count from public.journal_lines where entry_id=v_entry.id;
  if v_count<2 or v_total_debit<=0 or v_total_debit<>v_total_credit
     or exists(select 1 from public.journal_lines where entry_id=v_entry.id and (debit is null or credit is null or debit<0 or credit<0 or debit>1000000000000 or credit>1000000000000 or (debit>0 and credit>0) or debit<>round(debit,2) or credit<>round(credit,2) or debit in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or credit in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))) then
    raise exception 'Jurnal sumber tidak lengkap atau tidak seimbang';
  end if;
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
    values(v_reversal,public.sales_next_number('JRN',v_entry.tanggal),v_entry.tanggal,'Pembalik: '||v_entry.deskripsi,'manual-reversal',v_audit::text,v_entry.branch_id);
  insert into public.journal_lines(entry_id,account_id,debit,credit)
    select v_reversal,account_id,credit,debit from public.journal_lines where entry_id=v_entry.id;

  insert into public.journal_revisions(id,entry_id,branch_id,action,reason,before_value,after_value,reversal_journal_id,created_by)
    values(v_audit,v_entry.id,v_entry.branch_id,p_action,btrim(p_reason),
      jsonb_build_object('entry',to_jsonb(v_entry),'lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from public.journal_lines l where l.entry_id=v_entry.id)),
      '{}'::jsonb,v_reversal,auth.uid());

  if p_action='edit' then
    select coalesce(sum((x->>'debit')::numeric),0),coalesce(sum((x->>'credit')::numeric),0),count(*)
      into v_total_debit,v_total_credit,v_count
      from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) x
      where (x->>'debit')::numeric>0 or (x->>'credit')::numeric>0;
    if v_count<2 or v_total_debit<=0 or v_total_debit<>v_total_credit
       or exists(select 1 from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) x
                 where (x->>'account_id')::uuid is null or ((x->>'debit')::numeric>0 and (x->>'credit')::numeric>0)
                    or (x->>'debit')::numeric<0 or (x->>'credit')::numeric<0
                    or (x->>'debit')::numeric<>round((x->>'debit')::numeric,2) or (x->>'credit')::numeric<>round((x->>'credit')::numeric,2)
                    or (x->>'debit') in ('NaN','Infinity','-Infinity') or (x->>'credit') in ('NaN','Infinity','-Infinity')
                    or (x->>'debit')::numeric>1000000000000 or (x->>'credit')::numeric>1000000000000
                    or not exists(select 1 from public.coa_accounts a where a.id=(x->>'account_id')::uuid and a.is_active and not a.is_header)) then
      raise exception 'Baris koreksi tidak valid atau tidak seimbang';
    end if;
    v_replacement:=gen_random_uuid();
    insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
      values(v_replacement,public.sales_next_number('JRN',v_date),v_date,v_description,'manual-correction',v_audit::text,v_entry.branch_id);
    insert into public.journal_lines(entry_id,account_id,debit,credit)
      select v_replacement,(x->>'account_id')::uuid,(x->>'debit')::numeric,(x->>'credit')::numeric
      from jsonb_array_elements(p_lines) x where (x->>'debit')::numeric>0 or (x->>'credit')::numeric>0;
    update public.journal_entries set voided_at=now(),voided_by=auth.uid(),void_reason='Digantikan jurnal koreksi '||v_replacement::text,revision=revision+1 where id=v_entry.id;
  else
    update public.journal_entries set voided_at=now(),voided_by=auth.uid(),void_reason=btrim(p_reason),revision=revision+1 where id=v_entry.id;
  end if;
  update public.journal_revisions set replacement_journal_id=v_replacement,
    after_value=case when p_action='edit' then jsonb_build_object('entry',(select to_jsonb(e) from public.journal_entries e where e.id=v_replacement),'lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from public.journal_lines l where l.entry_id=v_replacement))
      else jsonb_build_object('entry',(select to_jsonb(e) from public.journal_entries e where e.id=v_entry.id)) end where id=v_audit;
  v_result:=jsonb_build_object('entry_id',v_entry.id,'revision_id',v_audit,'reversal_journal_id',v_reversal,'replacement_journal_id',v_replacement);
  insert into public.journal_revision_requests(actor_id,request_key,entry_id,payload,result) values(auth.uid(),p_request_key,v_entry.id,v_payload,v_result);
  return v_result;
end $$;
revoke all on function public.revise_manual_journal(text,uuid,integer,text,jsonb,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.revise_manual_journal(text,uuid,integer,text,jsonb,jsonb,text) to authenticated;
