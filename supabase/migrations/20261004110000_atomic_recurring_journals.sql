-- Monthly recurring posting is one transaction: identity, lines and progress.
-- Existing short references remain unchanged and are checked before reuse.
alter table public.journal_entries alter column source_ref type varchar(64);

create function public.post_recurring_journal_period(p_recurring_id uuid,p_periode text)
returns table(entry_id uuid,no_jurnal text,posted boolean)
language plpgsql security invoker
set search_path=pg_catalog,public
as $$
declare
 v_schedule public.recurring_journals%rowtype;
 v_entry public.journal_entries%rowtype;
 v_today date:=(statement_timestamp() at time zone 'Asia/Jakarta')::date;
 v_date date;
 v_ref text;
 v_legacy_ref text;
 v_count integer;
 v_lines jsonb:='[]'::jsonb;
 v_line record;
 v_account uuid;
 v_debit numeric:=0;
 v_credit numeric:=0;
 v_prefix text;
 v_seq bigint;
 v_number text;
 v_constraint text;
 v_role text;
begin
 if auth.uid() is null and current_user<>'service_role' then
  raise exception 'Sesi login diperlukan untuk posting jurnal berulang.' using errcode='42501';
 end if;
 if p_periode is null or p_periode!~'^[0-9]{4}-(0[1-9]|1[0-2])$' then
  raise exception 'RECURRING_PERIOD: periode tidak valid.';
 end if;
 select * into v_schedule from public.recurring_journals where id=p_recurring_id for update;
 if not found then raise exception 'Jurnal berulang tidak ditemukan.' using errcode='42501'; end if;
 -- Check after waiting for the schedule lock. A JWT can remain valid after its
 -- profile has been disabled; legacy journal/table RLS does not check this flag.
 if current_user<>'service_role' then
  select p.role::text into v_role from public.profiles p
   where p.id=auth.uid() and p.is_active for share;
  if not found then
   raise exception 'RECURRING_AUTH: Akun tidak aktif atau profil tidak ditemukan.' using errcode='42501';
  end if;
  -- Match lib/akses.ts: OWNER is never module-restricted; explicit rows
  -- override defaults, whose buku-besar access excludes only STAFF.
  if v_role<>'OWNER' and (
    (exists(select 1 from public.role_modules m where m.role::text=v_role)
      and not exists(select 1 from public.role_modules m where m.role::text=v_role and m.module_id='buku-besar'))
    or (v_role='STAFF' and not exists(select 1 from public.role_modules m where m.role::text=v_role))
  )then
   raise exception 'RECURRING_MODULE: Akses Buku Besar diperlukan untuk jurnal berulang.' using errcode='42501';
  end if;
 end if;
 if current_user<>'service_role' and v_schedule.branch_id is not null
    and not public.user_can_access_branch(v_schedule.branch_id) then
  raise exception 'RECURRING_SCOPE: Cabang jurnal berulang tidak dapat diakses.' using errcode='42501';
 end if;
 v_date:=(p_periode||'-'||lpad(v_schedule.day_of_month::text,2,'0'))::date;
 if v_date>v_today then raise exception 'RECURRING_PERIOD: tanggal jurnal belum jatuh tempo menurut WIB.'; end if;
 v_ref:=p_recurring_id::text||':'||p_periode;
 v_legacy_ref:=left(p_recurring_id::text,8)||'-'||p_periode;

 if exists(select 1 from public.journal_entries where source='recurring' and source_ref=v_legacy_ref)
    and (select count(*) from public.recurring_journals where left(id::text,8)=left(p_recurring_id::text,8))<>1 then
  raise exception 'RECURRING_HISTORY: identitas jurnal lama ambigu; minta keuangan meninjau.';
 end if;
 select count(*) into v_count from public.journal_entries
 where source='recurring' and source_ref in(v_ref,v_legacy_ref);
 if v_count>1 then
  raise exception 'RECURRING_HISTORY: ada lebih dari satu jurnal untuk bulan ini; minta keuangan meninjau.';
 elsif v_count=1 then
  select * into v_entry from public.journal_entries
   where source='recurring' and source_ref in(v_ref,v_legacy_ref)for update;
  select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)
   into v_count,v_debit,v_credit from public.journal_lines where journal_lines.entry_id=v_entry.id;
  if v_count<2 or v_debit<=0 or v_debit<>v_credit or nullif(btrim(v_entry.no_jurnal),'') is null
     or v_entry.tanggal<>v_date or v_entry.branch_id is distinct from v_schedule.branch_id
     or exists(select 1 from public.journal_lines where journal_lines.entry_id=v_entry.id
       and (debit<0 or credit<0 or (debit>0 and credit>0)
         or debit::text in('NaN','Infinity','-Infinity')
         or credit::text in('NaN','Infinity','-Infinity'))) then
   raise exception 'RECURRING_HISTORY: jurnal lama tidak lengkap atau tidak seimbang; minta keuangan meninjau.';
  end if;
 else
  if v_schedule.last_posted is not null and p_periode<=v_schedule.last_posted then
   raise exception 'RECURRING_HISTORY: penanda posting tidak memiliki jurnal; minta keuangan meninjau.';
  end if;
 end if;

 -- A verified prior posting can be replayed even after the schedule is disabled.
 if v_schedule.last_posted is not null and p_periode<=v_schedule.last_posted then
  return query select v_entry.id,v_entry.no_jurnal::text,false;
  return;
 end if;
 if not v_schedule.is_active then raise exception 'Jurnal berulang sedang nonaktif.'; end if;
 if (v_schedule.last_posted is null and p_periode<>to_char(v_today,'YYYY-MM'))
    or (v_schedule.last_posted is not null and p_periode<>
      to_char((v_schedule.last_posted::text||'-01')::date+interval '1 month','YYYY-MM')) then
  raise exception 'RECURRING_PERIOD: posting harus mengikuti urutan bulan yang tertinggal.';
 end if;
 -- Check the historical progress marker before moving past it. This nested
 -- call only validates an already-marked month and returns without writing.
 if v_schedule.last_posted is not null then
  perform 1 from public.post_recurring_journal_period(p_recurring_id,v_schedule.last_posted::text);
 end if;

 if v_entry.id is not null then
  -- Recover only a complete legacy/full journal whose response/marker was lost.
  update public.recurring_journals set last_posted=p_periode where id=p_recurring_id;
  return query select v_entry.id,v_entry.no_jurnal::text,false;
  return;
 end if;
 if jsonb_typeof(v_schedule.lines) is distinct from 'array' then
  raise exception 'Baris jurnal berulang tidak valid.';
 end if;
 for v_line in select * from jsonb_to_recordset(v_schedule.lines)as l(code text,debit numeric,credit numeric) loop
  if v_line.code is null or coalesce(v_line.debit,0)<0 or coalesce(v_line.credit,0)<0
     or (coalesce(v_line.debit,0)>0 and coalesce(v_line.credit,0)>0)
     or coalesce(v_line.debit,0)::text in('NaN','Infinity','-Infinity')
     or coalesce(v_line.credit,0)::text in('NaN','Infinity','-Infinity') then
   raise exception 'Baris jurnal berulang tidak valid.';
  end if;
  if coalesce(v_line.debit,0)=0 and coalesce(v_line.credit,0)=0 then continue; end if;
  select id into v_account from public.coa_accounts where code=v_line.code and is_active and not is_header;
  if not found then raise exception 'Akun % tidak tersedia sebagai akun detail aktif.',v_line.code; end if;
  v_debit:=v_debit+coalesce(v_line.debit,0);
  v_credit:=v_credit+coalesce(v_line.credit,0);
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_account,
    'debit',coalesce(v_line.debit,0),'credit',coalesce(v_line.credit,0)));
 end loop;
 if jsonb_array_length(v_lines)<2 or v_debit<=0 or v_debit<>v_credit then
  raise exception 'Jurnal berulang harus seimbang dengan minimal dua baris.';
 end if;

 v_prefix:='JRN-'||to_char(v_date,'YYYYMM')||'-';
 perform pg_advisory_xact_lock(hashtext('vetos:journal:'||v_prefix)::bigint);
 select coalesce(max((substring(substring(e.no_jurnal from length(v_prefix)+1) from '^[0-9]+'))::bigint),0)+1
  into v_seq from public.journal_entries e where left(e.no_jurnal,length(v_prefix))=v_prefix;
 loop
  v_number:=v_prefix||lpad(v_seq::text,greatest(4,length(v_seq::text)),'0');
  begin
   insert into public.journal_entries(no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
   values(v_number,v_date,v_schedule.nama||' (jurnal berulang '||p_periode||')'||
    case when v_schedule.deskripsi is null then '' else ' — '||v_schedule.deskripsi end,
    'recurring',v_ref,v_schedule.branch_id)returning * into v_entry;
   exit;
  exception when unique_violation then
   get stacked diagnostics v_constraint=constraint_name;
   if v_constraint<>'journal_entries_no_jurnal_key' then raise; end if;
   v_seq:=v_seq+1;
  end;
 end loop;
 insert into public.journal_lines(entry_id,account_id,debit,credit)
 select v_entry.id,l.account_id,l.debit,l.credit from jsonb_to_recordset(v_lines)as l(account_id uuid,debit numeric,credit numeric);
 update public.recurring_journals set last_posted=p_periode where id=p_recurring_id;
 return query select v_entry.id,v_entry.no_jurnal::text,true;
end;
$$;
revoke all on function public.post_recurring_journal_period(uuid,text)from public,anon;
grant execute on function public.post_recurring_journal_period(uuid,text)to authenticated,service_role;
