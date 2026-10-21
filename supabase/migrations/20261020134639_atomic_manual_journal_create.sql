-- Manual headers and lines must commit together and retain one durable result.
create table public.manual_journal_create_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_key text not null check (length(request_key) between 1 and 120),
  entry_id uuid not null references public.journal_entries(id) on delete restrict,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,request_key)
);
alter table public.manual_journal_create_requests enable row level security;
revoke all on public.manual_journal_create_requests from public,anon,authenticated,service_role;

create function public.create_manual_journal_atomic(
  p_request_key text,p_tanggal date,p_deskripsi text,p_branch_id uuid,p_lines jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor public.profiles%rowtype;
  v_prior public.manual_journal_create_requests%rowtype;
  v_key text:=btrim(coalesce(p_request_key,''));
  v_payload jsonb; v_result jsonb; v_entry uuid:=gen_random_uuid(); v_no text;
  v_line jsonb; v_account uuid; v_debit numeric; v_credit numeric;
  v_total_debit numeric:=0; v_total_credit numeric:=0; v_count integer:=0;
  v_valid jsonb:='[]'::jsonb; v_closed date;
begin
  if auth.uid() is null then raise exception 'Akses keuangan aktif diperlukan' using errcode='42501'; end if;
  if length(v_key) not between 1 and 120 or p_tanggal is null
    or length(btrim(coalesce(p_deskripsi,''))) not between 1 and 1000
    or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) not between 2 and 500 then
    raise exception 'Identitas atau rincian jurnal tidak valid';
  end if;
  v_payload:=jsonb_build_object('tanggal',p_tanggal,'deskripsi',btrim(p_deskripsi),'branch_id',p_branch_id,'lines',p_lines);
  perform pg_advisory_xact_lock(hashtextextended('vetos:manual-create:'||auth.uid()::text||':'||v_key,0));
  select * into v_actor from public.profiles where id=auth.uid() for update;
  if not found or not v_actor.is_active or v_actor.role not in ('OWNER','ADMIN','FINANCE') then
    raise exception 'Akses keuangan aktif diperlukan' using errcode='42501';
  end if;
  if v_actor.role<>'OWNER'
    and exists(select 1 from public.role_modules where role=v_actor.role)
    and not exists(select 1 from public.role_modules where role=v_actor.role and module_id='buku-besar') then
    raise exception 'Akses Buku Besar diperlukan' using errcode='42501';
  end if;
  if p_branch_id is null then
    if not public.has_role_capability('all_branches') then raise exception 'Cabang jurnal wajib dipilih' using errcode='42501'; end if;
  elsif not public.user_can_access_branch(p_branch_id)
    or not exists(select 1 from public.branches where id=p_branch_id and is_active) then
    raise exception 'Cabang jurnal tidak dapat diakses' using errcode='42501';
  end if;
  select * into v_prior from public.manual_journal_create_requests where actor_id=auth.uid() and request_key=v_key;
  if found then
    if v_prior.payload is distinct from v_payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda'; end if;
    return v_prior.result;
  end if;
  if p_tanggal>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal jurnal belum boleh di masa depan'; end if;
  select closed_until into v_closed from public.accounting_locks where id for share;
  if v_closed is not null and p_tanggal<=v_closed then raise exception 'Periode akuntansi sudah ditutup'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) is distinct from 'object' then raise exception 'Baris jurnal tidak valid'; end if;
    v_debit:=(v_line->>'debit')::numeric; v_credit:=(v_line->>'credit')::numeric;
    if v_debit is null or v_credit is null or v_debit<0 or v_credit<0
      or v_debit>1000000000000 or v_credit>1000000000000
      or v_debit<>round(v_debit,2) or v_credit<>round(v_credit,2)
      or v_debit::text in ('NaN','Infinity','-Infinity') or v_credit::text in ('NaN','Infinity','-Infinity')
      or (v_debit>0 and v_credit>0) then raise exception 'Nilai baris jurnal tidak valid'; end if;
    if v_debit=0 and v_credit=0 then continue; end if;
    v_account:=nullif(v_line->>'account_id','')::uuid;
    perform 1 from public.coa_accounts where id=v_account and is_active and not is_header for share;
    if not found then raise exception 'Akun baris jurnal tidak valid'; end if;
    v_count:=v_count+1; v_total_debit:=v_total_debit+v_debit; v_total_credit:=v_total_credit+v_credit;
    v_valid:=v_valid||jsonb_build_array(jsonb_build_object('account_id',v_account,'debit',v_debit,'credit',v_credit));
  end loop;
  if v_count<2 or v_total_debit<=0 or v_total_debit<>v_total_credit
    or v_total_debit>1000000000000 then raise exception 'Jurnal tidak seimbang atau jumlah tidak valid'; end if;
  v_no:=public.sales_next_number('JRN',p_tanggal);
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
    values(v_entry,v_no,p_tanggal,btrim(p_deskripsi),'manual',v_entry::text,p_branch_id);
  insert into public.journal_lines(entry_id,account_id,debit,credit)
    select v_entry,(x->>'account_id')::uuid,(x->>'debit')::numeric,(x->>'credit')::numeric
    from jsonb_array_elements(v_valid) x;
  v_result:=jsonb_build_object('entry_id',v_entry,'no_jurnal',v_no);
  insert into public.manual_journal_create_requests(actor_id,request_key,entry_id,payload,result)
    values(v_actor.id,v_key,v_entry,v_payload,v_result);
  return v_result;
end $$;
revoke all on function public.create_manual_journal_atomic(text,date,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_manual_journal_atomic(text,date,text,uuid,jsonb) to authenticated;
