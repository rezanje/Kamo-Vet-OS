-- J04: recurring journals sourced from an existing manual journal.
-- Source data and receipts live in finance/branch-scoped immutable tables;
-- the globally-readable legacy template row contains only a generic marker.
alter table public.recurring_journals
  add column is_source_schedule boolean not null default false;

create table public.recurring_journal_sources (
  schedule_id uuid primary key references public.recurring_journals(id) on delete restrict,
  source_entry_id uuid not null unique references public.journal_entries(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  request_key text not null check (length(request_key) between 1 and 120),
  payload jsonb not null,
  source_snapshot jsonb not null,
  config jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(actor_id,request_key)
);
alter table public.recurring_journal_sources enable row level security;
revoke all on public.recurring_journal_sources from public,anon,authenticated,service_role;
grant select(schedule_id,source_entry_id,branch_id,source_snapshot,config,created_at)
  on public.recurring_journal_sources to authenticated;
create policy recurring_journal_sources_read on public.recurring_journal_sources
  for select to authenticated using (
    (select auth.uid()) is not null
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)
    and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active
      and p.role in('OWNER','ADMIN','FINANCE')
      and (p.role='OWNER' or not exists(select 1 from public.role_modules m where m.role=p.role)
        or exists(select 1 from public.role_modules m where m.role=p.role and m.module_id='buku-besar')))
    and ((branch_id is null and public.has_role_capability('all_branches'))
      or (branch_id is not null and public.user_can_access_branch(branch_id)))
  );

create table public.recurring_source_occurrences (
  schedule_id uuid not null references public.recurring_journal_sources(schedule_id) on delete restrict,
  period text not null check(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  journal_id uuid not null unique references public.journal_entries(id) on delete restrict,
  executed_by uuid not null references public.profiles(id) on delete restrict,
  executed_at timestamptz not null default now(),
  receipt jsonb not null,
  primary key(schedule_id,period)
);
alter table public.recurring_source_occurrences enable row level security;
revoke all on public.recurring_source_occurrences from public,anon,authenticated,service_role;
grant select(schedule_id,period,journal_id,executed_by,executed_at,receipt)
  on public.recurring_source_occurrences to authenticated;
create policy recurring_source_occurrences_read on public.recurring_source_occurrences
  for select to authenticated using (
    exists(select 1 from public.recurring_journal_sources s
      where s.schedule_id=recurring_source_occurrences.schedule_id)
  );

create function public.recurring_source_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'Bukti jurnal sumber bersifat tetap dan tidak dapat diubah atau dihapus' using errcode='42501';
end$$;
revoke all on function public.recurring_source_immutable() from public,anon,authenticated,service_role;
create trigger recurring_journal_sources_immutable before update or delete
  on public.recurring_journal_sources for each row execute function public.recurring_source_immutable();
create trigger recurring_journal_sources_no_truncate before truncate
  on public.recurring_journal_sources for each statement execute function public.recurring_source_immutable();
create trigger recurring_source_occurrences_immutable before update or delete
  on public.recurring_source_occurrences for each row execute function public.recurring_source_immutable();
create trigger recurring_source_occurrences_no_truncate before truncate
  on public.recurring_source_occurrences for each statement execute function public.recurring_source_immutable();

create function public.recurring_require_finance() returns uuid
language plpgsql security definer set search_path='' as $$
declare v_actor public.profiles%rowtype;
begin
  if (select auth.uid()) is null or coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false) then
    raise exception 'Akses Buku Besar diperlukan' using errcode='42501';
  end if;
  select * into v_actor from public.profiles p where p.id=(select auth.uid()) for share;
  if not found or not v_actor.is_active or v_actor.role not in('OWNER','ADMIN','FINANCE') then
    raise exception 'Akses keuangan aktif diperlukan' using errcode='42501';
  end if;
  if v_actor.role<>'OWNER' and exists(select 1 from public.role_modules m where m.role=v_actor.role)
    and not exists(select 1 from public.role_modules m where m.role=v_actor.role and m.module_id='buku-besar') then
    raise exception 'Akses Buku Besar diperlukan' using errcode='42501';
  end if;
  return v_actor.id;
end$$;
revoke all on function public.recurring_require_finance() from public,anon,authenticated,service_role;

create function public.recurring_require_branch(p_branch_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_branch_id is null then
    if not public.has_role_capability('all_branches') then
      raise exception 'Cabang jurnal wajib dipilih' using errcode='42501';
    end if;
  elsif not public.user_can_access_branch(p_branch_id)
    or not exists(select 1 from public.branches b where b.id=p_branch_id and b.is_active) then
    raise exception 'Cabang jurnal tidak dapat diakses' using errcode='42501';
  end if;
end$$;
revoke all on function public.recurring_require_branch(uuid) from public,anon,authenticated,service_role;

create function public.recurring_source_snapshot(p_entry_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with head as (
    select e.id,e.no_jurnal,e.tanggal,e.branch_id,e.revision,e.source,e.deskripsi,e.voided_at
    from public.journal_entries e where e.id=p_entry_id
  ), canonical as (
    select jsonb_build_object(
      'entry_id',h.id,'no_jurnal',h.no_jurnal,'tanggal',h.tanggal,'branch_id',h.branch_id,
      'revision',h.revision,'source',h.source,'deskripsi',h.deskripsi,'voided_at',h.voided_at,
      'lines',coalesce((select jsonb_agg(jsonb_build_object(
        'line_id',l.id,'account_id',a.id,'code',a.code,'debit',l.debit,'credit',l.credit
      ) order by l.id) from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
        where l.entry_id=h.id),'[]'::jsonb)
    ) as value from head h
  ) select value||jsonb_build_object('version',md5(value::text)) from canonical
$$;
revoke all on function public.recurring_source_snapshot(uuid) from public,anon,authenticated,service_role;

create function public.recurring_validate_source(p_snapshot jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v_line jsonb;v_debit numeric;v_credit numeric;v_total_debit numeric:=0;v_total_credit numeric:=0;v_count integer:=0;v_account uuid;
begin
  if p_snapshot is null or p_snapshot->>'source' not in('manual','manual-correction')
    or p_snapshot->>'voided_at' is not null or nullif(btrim(p_snapshot->>'no_jurnal'),'') is null
    or p_snapshot->>'tanggal' is null or jsonb_typeof(p_snapshot->'lines') is distinct from 'array'
    or jsonb_array_length(p_snapshot->'lines') not between 2 and 500 then
    raise exception 'Jurnal sumber tidak valid atau bukan jurnal manual yang aktif' using errcode='22023';
  end if;
  for v_line in select value from jsonb_array_elements(p_snapshot->'lines') loop
    v_debit:=(v_line->>'debit')::numeric;v_credit:=(v_line->>'credit')::numeric;
    v_account:=nullif(v_line->>'account_id','')::uuid;
    if v_account is null or v_debit is null or v_credit is null or v_debit<0 or v_credit<0
      or v_debit>1000000000000 or v_credit>1000000000000 or v_debit<>round(v_debit,2) or v_credit<>round(v_credit,2)
      or v_debit::text in('NaN','Infinity','-Infinity') or v_credit::text in('NaN','Infinity','-Infinity')
      or(v_debit>0 and v_credit>0) or (v_debit=0 and v_credit=0)
      or not exists(select 1 from public.coa_accounts a where a.id=v_account and a.is_active and not a.is_header and a.code=v_line->>'code') then
      raise exception 'Jurnal sumber memuat baris atau akun yang tidak valid' using errcode='22023';
    end if;
    v_count:=v_count+1;v_total_debit:=v_total_debit+v_debit;v_total_credit:=v_total_credit+v_credit;
  end loop;
  if v_count<2 or v_total_debit<=0 or v_total_debit<>v_total_credit or v_total_debit>1000000000000 then
    raise exception 'Jurnal sumber tidak seimbang atau tidak valid' using errcode='22023';
  end if;
end$$;
revoke all on function public.recurring_validate_source(jsonb) from public,anon,authenticated,service_role;

create function public.recurring_source_period_index(p_period text) returns integer
language plpgsql immutable strict set search_path='' as $$
begin
  if p_period!~'^[0-9]{4}-(0[1-9]|1[0-2])$' or substring(p_period,1,4)::integer not between 1 and 9999 then return null;end if;
  return (substring(p_period,1,4)::integer-1)*12+substring(p_period,6,2)::integer-1;
exception when invalid_text_representation then return null;
end
$$;
revoke all on function public.recurring_source_period_index(text) from public,anon,authenticated,service_role;

create function public.recurring_source_period_text(p_index integer) returns text
language sql immutable strict set search_path='' as $$
  select lpad((p_index/12+1)::text,4,'0')||'-'||lpad((p_index%12+1)::text,2,'0') where p_index between 0 and 119987
$$;
revoke all on function public.recurring_source_period_text(integer) from public,anon,authenticated,service_role;

create function public.preview_recurring_journal_source(p_entry_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_entry public.journal_entries%rowtype;v_snapshot jsonb;
begin
  perform public.recurring_require_finance();
  select * into v_entry from public.journal_entries e where e.id=p_entry_id for share;
  if not found then raise exception 'Jurnal sumber tidak ditemukan atau tidak dapat diakses' using errcode='42501';end if;
  perform public.recurring_require_branch(v_entry.branch_id);
  perform l.id from public.journal_lines l where l.entry_id=v_entry.id order by l.id for share;
  perform a.id from public.coa_accounts a join public.journal_lines l on l.account_id=a.id
    where l.entry_id=v_entry.id order by a.id for share of a;
  v_snapshot:=public.recurring_source_snapshot(v_entry.id);
  perform public.recurring_validate_source(v_snapshot);
  return v_snapshot;
end$$;
revoke all on function public.preview_recurring_journal_source(uuid) from public,anon,service_role;
grant execute on function public.preview_recurring_journal_source(uuid) to authenticated;

create function public.create_recurring_journal_from_source(
  p_request_key text,p_source_entry_id uuid,p_expected_snapshot jsonb,p_name text,
  p_first_period text,p_day integer,p_count integer,p_end_period text,
  p_confirm_backdated boolean,p_confirm_source boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid;v_entry public.journal_entries%rowtype;v_existing public.recurring_journal_sources%rowtype;
  v_snapshot jsonb;v_payload jsonb;v_config jsonb;v_result jsonb;v_schedule_id uuid:=gen_random_uuid();
  v_key text:=btrim(coalesce(p_request_key,''));v_name text:=btrim(coalesce(p_name,''));
  v_first integer;v_end integer;v_source_period integer;v_count integer;v_last text;v_today text;
begin
  v_actor:=public.recurring_require_finance();
  if length(v_key) not between 1 and 120 or p_source_entry_id is null or p_expected_snapshot is null
    or length(v_name) not between 1 and 80 or p_day not between 1 and 28
    or p_confirm_backdated is null or p_confirm_source is distinct from true
    or public.recurring_source_period_index(p_first_period) is null
    or (p_end_period is not null and public.recurring_source_period_index(p_end_period) is null) then
    raise exception 'Identitas atau pilihan jadwal jurnal sumber tidak valid' using errcode='22023';
  end if;
  v_payload:=jsonb_build_object('source_entry_id',p_source_entry_id,'expected_snapshot',p_expected_snapshot,
    'name',v_name,'first_period',p_first_period,'day',p_day,'count',p_count,'end_period',p_end_period,
    'confirm_backdated',p_confirm_backdated,'confirm_source',p_confirm_source);
  perform pg_advisory_xact_lock(hashtextextended('kamo:recurring-source-create:'||v_actor::text||':'||v_key,0));
  select * into v_existing from public.recurring_journal_sources s where s.actor_id=v_actor and s.request_key=v_key;
  if found then
    if v_existing.payload is distinct from v_payload then
      raise exception 'Kunci permintaan sudah dipakai dengan pilihan berbeda' using errcode='22023';
    end if;
    perform public.recurring_require_branch(v_existing.branch_id);
    return v_existing.result;
  end if;

  -- Lock the original header before the lines/accounts so concurrent setup
  -- requests and official source corrections serialize on the same journal.
  select * into v_entry from public.journal_entries e where e.id=p_source_entry_id for update;
  if not found then raise exception 'Jurnal sumber tidak ditemukan atau tidak dapat diakses' using errcode='42501';end if;
  perform public.recurring_require_branch(v_entry.branch_id);
  perform l.id from public.journal_lines l where l.entry_id=v_entry.id order by l.id for share;
  perform a.id from public.coa_accounts a join public.journal_lines l on l.account_id=a.id
    where l.entry_id=v_entry.id order by a.id for share of a;
  v_snapshot:=public.recurring_source_snapshot(v_entry.id);
  perform public.recurring_validate_source(v_snapshot);
  if p_expected_snapshot is distinct from v_snapshot then
    raise exception 'RECURRING_SOURCE_STALE: Jurnal sumber berubah. Muat ulang pratinjau.' using errcode='40001';
  end if;
  if exists(select 1 from public.recurring_journal_sources s where s.source_entry_id=v_entry.id) then
    raise exception 'RECURRING_SOURCE_DUPLICATE: Sumber ini sudah memiliki jadwal. Buka jadwal yang ada.' using errcode='23505';
  end if;

  v_first:=public.recurring_source_period_index(p_first_period);
  v_source_period:=public.recurring_source_period_index(left(v_snapshot->>'tanggal',7));
  v_today:=to_char(statement_timestamp() at time zone 'Asia/Jakarta','YYYY-MM');
  if v_first<=v_source_period then
    raise exception 'Bulan pertama harus setelah bulan jurnal sumber' using errcode='22023';
  end if;
  if v_first<public.recurring_source_period_index(v_today) and not p_confirm_backdated then
    raise exception 'Konfirmasi periode mundur diperlukan sebelum membuat jadwal' using errcode='22023';
  end if;
  if p_count is null and p_end_period is null then
    raise exception 'Pilih jumlah periode atau bulan terakhir' using errcode='22023';
  end if;
  if p_count is not null then
    if p_count<=0 or v_first+p_count-1>119987 then
      raise exception 'Jumlah periode jurnal sumber tidak valid' using errcode='22023';
    end if;
    v_count:=p_count;v_end:=v_first+v_count-1;
    if p_end_period is not null and public.recurring_source_period_index(p_end_period)<>v_end then
      raise exception 'Jumlah periode dan bulan terakhir tidak cocok' using errcode='22023';
    end if;
  else
    v_end:=public.recurring_source_period_index(p_end_period);
    if v_end<v_first then raise exception 'Bulan terakhir harus sama atau setelah bulan pertama' using errcode='22023';end if;
    v_count:=v_end-v_first+1;
  end if;
  v_last:=public.recurring_source_period_text(v_end);
  if v_last is null then raise exception 'Bulan terakhir berada di luar rentang kalender' using errcode='22023';end if;
  v_config:=jsonb_build_object('name',v_name,'first_period',p_first_period,'day',p_day,
    'count',v_count,'last_period',v_last,'mode','manual');
  v_result:=jsonb_build_object('schedule_id',v_schedule_id,'source_id',v_entry.id,
    'source_no',v_entry.no_jurnal,'first_period',p_first_period,'last_period',v_last,'count',v_count,'mode','manual');

  insert into public.recurring_journals(id,nama,deskripsi,day_of_month,branch_id,lines,is_active,last_posted,created_by,max_occurrences,is_source_schedule)
    values(v_schedule_id,'Jurnal dari sumber',null,p_day,v_entry.branch_id,'[]'::jsonb,true,null,v_actor,v_count,true);
  insert into public.recurring_journal_sources(schedule_id,source_entry_id,branch_id,actor_id,request_key,payload,source_snapshot,config,result)
    values(v_schedule_id,v_entry.id,v_entry.branch_id,v_actor,v_key,v_payload,v_snapshot,v_config,v_result);
  return v_result;
end$$;
revoke all on function public.create_recurring_journal_from_source(text,uuid,jsonb,text,text,integer,integer,text,boolean,boolean) from public,anon,service_role;
grant execute on function public.create_recurring_journal_from_source(text,uuid,jsonb,text,text,integer,integer,text,boolean,boolean) to authenticated;

create function public.get_recurring_journal_source_result(p_request_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_source public.recurring_journal_sources%rowtype;
begin
  v_actor:=public.recurring_require_finance();
  if length(btrim(coalesce(p_request_key,''))) not between 1 and 120 then return null;end if;
  select * into v_source from public.recurring_journal_sources s where s.actor_id=v_actor and s.request_key=btrim(p_request_key);
  if not found then return null;end if;
  perform public.recurring_require_branch(v_source.branch_id);
  return v_source.result;
end$$;
revoke all on function public.get_recurring_journal_source_result(text) from public,anon,service_role;
grant execute on function public.get_recurring_journal_source_result(text) to authenticated;

create function public.recurring_source_receipt_matches(
  p_snapshot jsonb,p_entry_id uuid,p_period text,p_schedule_id uuid,p_branch_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.journal_entries e where e.id=p_entry_id and e.source='recurring'
      and e.source_ref=p_schedule_id::text||':'||p_period and e.tanggal=(p_period||'-01')::date+(coalesce((select r.day_of_month from public.recurring_journals r where r.id=p_schedule_id),1)-1)
      and e.branch_id is not distinct from p_branch_id and e.voided_at is null)
    and not exists(
      (select l.account_id,l.debit,l.credit from public.journal_lines l where l.entry_id=p_entry_id)
      except all
      (select (line->>'account_id')::uuid,(line->>'debit')::numeric,(line->>'credit')::numeric
        from jsonb_array_elements(p_snapshot->'lines') expected(line))
    )
    and not exists(
      (select (line->>'account_id')::uuid,(line->>'debit')::numeric,(line->>'credit')::numeric
        from jsonb_array_elements(p_snapshot->'lines') expected(line))
      except all
      (select l.account_id,l.debit,l.credit from public.journal_lines l where l.entry_id=p_entry_id)
    )
$$;
revoke all on function public.recurring_source_receipt_matches(jsonb,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;

create function public.post_recurring_journal_source_period(p_schedule_id uuid,p_period text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid;v_schedule public.recurring_journals%rowtype;v_source public.recurring_journal_sources%rowtype;
  v_source_entry public.journal_entries%rowtype;v_occ public.recurring_source_occurrences%rowtype;
  v_snapshot jsonb;v_live_snapshot jsonb;v_config jsonb;v_result jsonb;v_lines jsonb;
  v_first integer;v_last integer;v_period_idx integer;v_next integer;v_seen integer;
  v_min_period text;v_max_period text;v_expected_last text;v_today date;v_entry_id uuid;v_no text;
  v_date date;v_closed date;v_ref text;
begin
  if p_schedule_id is null or public.recurring_source_period_index(p_period) is null then
    raise exception 'RECURRING_SOURCE_PERIOD: periode tidak valid' using errcode='22023';
  end if;
  select * into v_schedule from public.recurring_journals r where r.id=p_schedule_id for update;
  if not found then raise exception 'RECURRING_SOURCE_HISTORY: jadwal sumber tidak ditemukan' using errcode='42501';end if;
  v_actor:=public.recurring_require_finance();
  perform public.recurring_require_branch(v_schedule.branch_id);
  select * into v_source from public.recurring_journal_sources s where s.schedule_id=p_schedule_id for share;
  if not found or not v_schedule.is_source_schedule then
    raise exception 'RECURRING_SOURCE_HISTORY: bukti jadwal sumber tidak lengkap' using errcode='P0001';
  end if;
  if v_schedule.branch_id is distinct from v_source.branch_id
    or v_schedule.day_of_month is distinct from (v_source.config->>'day')::integer
    or v_schedule.max_occurrences is distinct from (v_source.config->>'count')::integer
    or v_schedule.nama<>'Jurnal dari sumber' or v_schedule.deskripsi is not null
    or v_schedule.lines is distinct from '[]'::jsonb or v_schedule.created_by is distinct from v_source.actor_id
    or v_source.config->>'mode'<>'manual' then
    raise exception 'RECURRING_SOURCE_HISTORY: konfigurasi sumber berubah' using errcode='P0001';
  end if;
  v_snapshot:=v_source.source_snapshot;v_config:=v_source.config;
  v_first:=public.recurring_source_period_index(v_config->>'first_period');
  v_last:=public.recurring_source_period_index(v_config->>'last_period');
  v_period_idx:=public.recurring_source_period_index(p_period);
  if v_first is null or v_last is null or (v_config->>'count')::integer is null
    or v_last-v_first+1<>(v_config->>'count')::integer then
    raise exception 'RECURRING_SOURCE_HISTORY: batas periode sumber tidak konsisten' using errcode='P0001';
  end if;
  if v_period_idx>v_last then
    raise exception 'RECURRING_SOURCE_LIMIT: jumlah periode jadwal sudah selesai' using errcode='22023';
  elsif v_period_idx<v_first then
    raise exception 'RECURRING_SOURCE_PERIOD: bulan yang diminta sebelum periode pertama' using errcode='22023';
  end if;

  select * into v_occ from public.recurring_source_occurrences o
    where o.schedule_id=p_schedule_id and o.period=p_period;
  if found then
    if not public.recurring_source_receipt_matches(v_snapshot,v_occ.journal_id,p_period,p_schedule_id,v_source.branch_id)
      or v_occ.receipt->>'entry_id' is distinct from v_occ.journal_id::text
      or v_occ.receipt->>'period' is distinct from p_period
      or v_occ.receipt->>'schedule_id' is distinct from p_schedule_id::text
      or coalesce(trim(v_schedule.last_posted),'')<p_period then
      raise exception 'RECURRING_SOURCE_HISTORY: jurnal bukti periode tidak cocok' using errcode='P0001';
    end if;
    return v_occ.receipt||jsonb_build_object('posted',false);
  end if;

  select count(*),min(o.period),max(o.period) into v_seen,v_min_period,v_max_period
    from public.recurring_source_occurrences o where o.schedule_id=p_schedule_id;
  if v_seen>(v_config->>'count')::integer
    or (v_seen=0 and nullif(trim(v_schedule.last_posted),'') is not null)
    or (v_seen>0 and (v_min_period is distinct from v_config->>'first_period'
      or v_max_period is distinct from v_schedule.last_posted::text
      or public.recurring_source_period_index(v_max_period)<>v_first+v_seen-1)) then
    raise exception 'RECURRING_SOURCE_HISTORY: progres jadwal sumber tidak konsisten' using errcode='P0001';
  end if;
  if v_seen>0 then
    select * into v_occ from public.recurring_source_occurrences o where o.schedule_id=p_schedule_id order by o.period desc limit 1;
    if not public.recurring_source_receipt_matches(v_snapshot,v_occ.journal_id,v_occ.period,p_schedule_id,v_source.branch_id)
      or v_occ.receipt->>'entry_id' is distinct from v_occ.journal_id::text then
      raise exception 'RECURRING_SOURCE_HISTORY: jurnal terakhir tidak cocok dengan bukti' using errcode='P0001';
    end if;
  end if;

  if v_seen>0 then
    v_expected_last:=public.recurring_source_period_text(v_first+v_seen-1);
    if v_period_idx<=public.recurring_source_period_index(v_expected_last) then
      raise exception 'RECURRING_SOURCE_HISTORY: bukti periode hilang dari jadwal' using errcode='P0001';
    end if;
  end if;
  v_next:=v_first+v_seen;
  if v_period_idx<>v_next then
    raise exception 'RECURRING_SOURCE_PERIOD: jalankan hanya periode tertua yang belum dibuat' using errcode='22023';
  end if;
  if v_seen>=(v_config->>'count')::integer or p_period>v_config->>'last_period' then
    raise exception 'RECURRING_SOURCE_LIMIT: jumlah periode jadwal sudah selesai' using errcode='22023';
  end if;
  if not v_schedule.is_active then
    raise exception 'RECURRING_SOURCE_INACTIVE: aktifkan kembali jadwal sebelum membuat periode baru' using errcode='P0001';
  end if;
  v_date:=(p_period||'-01')::date+(v_schedule.day_of_month-1);
  v_today:=(statement_timestamp() at time zone 'Asia/Jakarta')::date;
  if v_date>v_today then
    raise exception 'RECURRING_SOURCE_PERIOD: tanggal periode belum jatuh tempo menurut WIB' using errcode='22023';
  end if;

  select * into v_source_entry from public.journal_entries e where e.id=v_source.source_entry_id for share;
  if not found then raise exception 'RECURRING_SOURCE_CHANGED: jurnal sumber tidak tersedia' using errcode='P0001';end if;
  perform l.id from public.journal_lines l where l.entry_id=v_source_entry.id order by l.id for share;
  perform a.id from public.coa_accounts a join public.journal_lines l on l.account_id=a.id
    where l.entry_id=v_source_entry.id order by a.id for share of a;
  v_live_snapshot:=public.recurring_source_snapshot(v_source_entry.id);
  if v_live_snapshot is distinct from v_snapshot or v_source_entry.voided_at is not null then
    raise exception 'RECURRING_SOURCE_CHANGED: jurnal atau akun sumber berubah; minta keuangan meninjau' using errcode='P0001';
  end if;
  perform public.recurring_validate_source(v_live_snapshot);
  select closed_until into v_closed from public.accounting_locks where id for share;
  if v_closed is not null and v_date<=v_closed then
    raise exception 'RECURRING_SOURCE_CLOSED: periode akuntansi sudah ditutup' using errcode='P0001';
  end if;

  select jsonb_agg(jsonb_build_object('code',line->>'code','debit',(line->>'debit')::numeric,'credit',(line->>'credit')::numeric) order by ord)
    into v_lines from jsonb_array_elements(v_snapshot->'lines') with ordinality as rows(line,ord);
  v_ref:=p_schedule_id::text||':'||p_period;
  v_entry_id:=public.clinic_write_journal(v_date,
    v_config->>'name'||' ('||p_period||') — '||coalesce(v_snapshot->>'deskripsi',''),
    'recurring',v_ref,v_source.branch_id,v_lines);
  select e.no_jurnal into v_no from public.journal_entries e where e.id=v_entry_id;
  if v_entry_id is null or nullif(btrim(v_no),'') is null
    or not public.recurring_source_receipt_matches(v_snapshot,v_entry_id,p_period,p_schedule_id,v_source.branch_id) then
    raise exception 'RECURRING_SOURCE_HISTORY: jurnal yang ditulis tidak cocok dengan sumber' using errcode='P0001';
  end if;
  v_result:=jsonb_build_object('schedule_id',p_schedule_id,'period',p_period,'entry_id',v_entry_id,'no_jurnal',v_no,'posted',true);
  update public.recurring_journals set last_posted=p_period where id=p_schedule_id;
  insert into public.recurring_source_occurrences(schedule_id,period,journal_id,executed_by,receipt)
    values(p_schedule_id,p_period,v_entry_id,v_actor,v_result);
  return v_result;
end$$;
revoke all on function public.post_recurring_journal_source_period(uuid,text) from public,anon,service_role;
grant execute on function public.post_recurring_journal_source_period(uuid,text) to authenticated;

-- Preserve all legacy posting behavior while refusing the new source-marker path.
do $$
declare v_def text;v_needle text:=$needle$ v_date:=(p_periode||'-'||lpad(v_schedule.day_of_month::text,2,'0'))::date;$needle$;
begin
  v_def:=pg_get_functiondef('public.post_recurring_journal_period(uuid,text)'::regprocedure);
  if length(v_def)-length(replace(v_def,v_needle,''))<>length(v_needle) then
    raise exception 'Legacy recurring posting insertion point changed';
  end if;
  execute replace(v_def,v_needle,
    $patch$ if v_schedule.is_source_schedule then raise exception 'RECURRING_SOURCE_MODE: jalankan jurnal sumber dari halaman jadwal sumber' using errcode='22023';end if;$patch$||chr(10)||v_needle);
end$$;

create function public.guard_recurring_source_schedule() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if current_user not in('authenticated','anon','service_role') then
    if tg_op='DELETE' then return old;else return new;end if;
  end if;
  if tg_op='INSERT' then
    if new.is_source_schedule then raise exception 'Jadwal jurnal sumber hanya dapat dibuat melalui konfirmasi' using errcode='42501';end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if old.is_source_schedule then raise exception 'Jadwal jurnal sumber tidak dapat dihapus' using errcode='42501';end if;
    return old;
  end if;
  if old.is_source_schedule or new.is_source_schedule then
    if not old.is_source_schedule or not new.is_source_schedule
      or (to_jsonb(new)-'is_active') is distinct from (to_jsonb(old)-'is_active') then
      raise exception 'RECURRING_SOURCE_MODE: jadwal sumber hanya dapat diubah melalui jalur terkonfirmasi' using errcode='42501';
    end if;
    if (select auth.uid()) is null or coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false) then
      raise exception 'Akses keuangan aktif diperlukan' using errcode='42501';
    end if;
    if not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active
      and p.role in('OWNER','ADMIN','FINANCE')
      and (p.role='OWNER' or not exists(select 1 from public.role_modules m where m.role=p.role)
        or exists(select 1 from public.role_modules m where m.role=p.role and m.module_id='buku-besar')))
      then raise exception 'Akses Buku Besar diperlukan' using errcode='42501';end if;
    perform 1 from public.profiles p where p.id=(select auth.uid()) for share;
    if old.branch_id is null then
      if not public.has_role_capability('all_branches') then raise exception 'Cabang jurnal wajib dipilih' using errcode='42501';end if;
    elsif not public.user_can_access_branch(old.branch_id)
      or not exists(select 1 from public.branches b where b.id=old.branch_id and b.is_active) then
      raise exception 'Cabang jurnal tidak dapat diakses' using errcode='42501';
    end if;
  end if;
  return new;
end$$;
revoke all on function public.guard_recurring_source_schedule() from public,anon,authenticated,service_role;
create trigger recurring_source_schedule_guard before insert or update or delete on public.recurring_journals
  for each row execute function public.guard_recurring_source_schedule();

create function public.guard_recurring_source_journal() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_old boolean:=false;v_new boolean:=false;v_old_id uuid;v_new_id uuid;
begin
  if current_user not in('authenticated','anon','service_role') then
    if tg_op='DELETE' then return old;else return new;end if;
  end if;
  if tg_table_name='journal_entries' then
    if tg_op<>'INSERT' then
      select exists(select 1 from public.recurring_journals r where r.is_source_schedule
        and left(old.source_ref,37)=r.id::text||':' and substring(old.source_ref from 38)~'^[0-9]{4}-(0[1-9]|1[0-2])$') into v_old;
    end if;
    if tg_op<>'DELETE' then
      select exists(select 1 from public.recurring_journals r where r.is_source_schedule
        and left(new.source_ref,37)=r.id::text||':' and substring(new.source_ref from 38)~'^[0-9]{4}-(0[1-9]|1[0-2])$') into v_new;
    end if;
  else
    if tg_op<>'INSERT' then v_old_id:=old.entry_id;end if;
    if tg_op<>'DELETE' then v_new_id:=new.entry_id;end if;
    if v_old_id is not null then
      select exists(select 1 from public.journal_entries e join public.recurring_journals r
        on r.is_source_schedule and left(e.source_ref,37)=r.id::text||':'
          and substring(e.source_ref from 38)~'^[0-9]{4}-(0[1-9]|1[0-2])$'
        where e.id=v_old_id and e.source='recurring') into v_old;
    end if;
    if v_new_id is not null then
      select exists(select 1 from public.journal_entries e join public.recurring_journals r
        on r.is_source_schedule and left(e.source_ref,37)=r.id::text||':'
          and substring(e.source_ref from 38)~'^[0-9]{4}-(0[1-9]|1[0-2])$'
        where e.id=v_new_id and e.source='recurring') into v_new;
    end if;
  end if;
  if v_old or v_new then raise exception 'Jurnal jadwal sumber hanya dapat diubah melalui posting resmi' using errcode='42501';end if;
  if tg_op='DELETE' then return old;else return new;end if;
end$$;
revoke all on function public.guard_recurring_source_journal() from public,anon,authenticated,service_role;
create trigger recurring_source_journal_header_guard before insert or update or delete on public.journal_entries
  for each row execute function public.guard_recurring_source_journal();
create trigger recurring_source_journal_line_guard before insert or update or delete on public.journal_lines
  for each row execute function public.guard_recurring_source_journal();
